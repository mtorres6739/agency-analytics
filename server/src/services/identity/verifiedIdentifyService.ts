import type { FastifyReply, FastifyRequest } from "fastify";
import type { IdentityTraits } from "@rybbit/shared";
import { z } from "zod";
import { redis } from "../../db/redis/redis.js";
import { siteConfig } from "../../lib/siteConfig.js";
import { createServiceLogger } from "../../lib/logger/logger.js";
import { userIdService } from "../userId/userIdService.js";
import { persistIdentifiedUser } from "../tracker/identifyService.js";
import { resolveClientIp } from "../tracker/resolveClientIp.js";
import { IdentityCryptoError, verifyIdentityAssertion } from "./identityCrypto.js";
import { getIdentityVerificationSecrets, markIdentityResult, touchIdentityKey } from "./identitySettingsService.js";

const logger = createServiceLogger("verified-identify");
const MAX_TRAITS_SIZE = 2048;
const REPLAY_TTL_SECONDS = 180;

const payloadSchema = z.object({
  site_id: z.string().min(1).max(64),
  assertion: z.string().min(1).max(8192),
});

function allowlistedTraits(traits: IdentityTraits, allowedTraits: string[]): Record<string, unknown> {
  const allowed = new Set(allowedTraits);
  const filtered = Object.fromEntries(Object.entries(traits).filter(([key]) => allowed.has(key)));
  if (new TextEncoder().encode(JSON.stringify(filtered)).length > MAX_TRAITS_SIZE) {
    throw new IdentityCryptoError("Identity traits exceed 2 KB", "INVALID_TRAITS");
  }
  return filtered;
}

export async function handleVerifiedIdentify(request: FastifyRequest, reply: FastifyReply) {
  const parsed = payloadSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ success: false, error: "Invalid payload", code: "INVALID_PAYLOAD" });
  }

  const configuration = await siteConfig.getConfig(parsed.data.site_id);
  if (!configuration) {
    return reply.status(404).send({ success: false, error: "Site not found", code: "SITE_NOT_FOUND" });
  }
  const siteId = configuration.siteId;
  const verification = await getIdentityVerificationSecrets(siteId);
  if (!verification) {
    return reply.status(403).send({
      success: false,
      error: "Verified identity is disabled for this site",
      code: "IDENTITY_DISABLED",
    });
  }

  try {
    let verified:
      | { claims: ReturnType<typeof verifyIdentityAssertion>; key: (typeof verification.keys)[number]["key"] }
      | undefined;
    let verificationError: unknown;
    for (const candidate of verification.keys) {
      try {
        verified = {
          claims: verifyIdentityAssertion({
            assertion: parsed.data.assertion,
            secret: candidate.secret,
            expectedSitePublicId: parsed.data.site_id,
          }),
          key: candidate.key,
        };
        break;
      } catch (error) {
        verificationError = error;
      }
    }
    if (!verified) throw verificationError;
    const { claims } = verified;
    const anonymousId = await userIdService.generateUserId(
      resolveClientIp(request),
      request.headers["user-agent"] || "",
      siteId
    );
    const replayKey = `identity:assertion:${siteId}:${claims.jti}`;
    let inserted: "OK" | null;
    try {
      inserted = await redis.set(replayKey, anonymousId, "EX", REPLAY_TTL_SECONDS, "NX");
    } catch (error) {
      logger.error({ error, siteId }, "Identity replay store unavailable");
      return reply.status(503).send({
        success: false,
        error: "Identity verification is temporarily unavailable",
        code: "REPLAY_STORE_UNAVAILABLE",
      });
    }
    const idempotent = !inserted;
    if (idempotent) {
      const priorAnonymousId = await redis.get(replayKey);
      if (priorAnonymousId !== anonymousId) {
        await markIdentityResult(siteId, false);
        return reply.status(409).send({
          success: false,
          error: "Identity assertion has already been used",
          code: "ASSERTION_REPLAYED",
        });
      }
    }

    const traits = allowlistedTraits(claims.traits, verification.settings.allowedTraits);
    await persistIdentifiedUser({
      siteId,
      anonymousId,
      userId: claims.sub,
      traits,
      identitySource: "verified",
    });
    await Promise.all([markIdentityResult(siteId, true), touchIdentityKey(verified.key.id)]);
    return reply.send({ success: true, user_id: claims.sub, ...(idempotent ? { idempotent: true } : {}) });
  } catch (error) {
    await markIdentityResult(siteId, false).catch(() => undefined);
    if (error instanceof IdentityCryptoError) {
      const status = error.code === "EXPIRED_ASSERTION" ? 401 : 400;
      return reply.status(status).send({ success: false, error: error.message, code: error.code });
    }
    logger.error({ error, siteId }, "Verified identity failed");
    return reply.status(500).send({
      success: false,
      error: "Failed to verify identity",
      code: "IDENTITY_ERROR",
    });
  }
}
