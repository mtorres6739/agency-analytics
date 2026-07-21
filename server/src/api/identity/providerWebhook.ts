import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../../db/postgres/postgres.js";
import { redis } from "../../db/redis/redis.js";
import { identityConsentReceipts } from "../../db/postgres/schema.js";
import { siteConfig } from "../../lib/siteConfig.js";
import { verifyCorrelationToken } from "../../services/identity/identityCrypto.js";
import { normalizeProviderResponse } from "../../services/identityResolution/providerPayload.js";
import { identityResolutionService } from "../../services/identityResolution/resolutionService.js";

const payloadSchema = z.object({
  event_id: z.string().min(1).max(255),
  site_id: z.string().min(1).max(64),
  correlation_token: z.string().min(1).max(4096),
  result: z.unknown(),
});

function validSignature(rawBody: Buffer, timestamp: string, signature: string, secret: string) {
  const expected = createHmac("sha256", secret).update(timestamp).update(".").update(rawBody).digest();
  const received = Buffer.from(signature.replace(/^sha256=/, ""), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function handleIdentityProviderWebhook(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const provider = z
    .enum(["customers_ai", "rb2b"])
    .safeParse((request.params as { provider?: string } | undefined)?.provider);
  if (!provider.success) return reply.status(404).send({ error: "Provider not supported" });
  const rawBody = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
  const timestamp = String(request.headers["x-identity-timestamp"] || "");
  const signature = String(request.headers["x-identity-signature"] || "");
  const secret = process.env[`${provider.data.toUpperCase()}_WEBHOOK_SECRET`]?.trim();
  if (!rawBody || !secret || !timestamp || !signature) {
    return reply.status(401).send({ error: "Webhook signature is required" });
  }
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    return reply.status(401).send({ error: "Webhook timestamp is invalid" });
  }
  if (!validSignature(rawBody, timestamp, signature, secret)) {
    return reply.status(401).send({ error: "Webhook signature is invalid" });
  }
  const parsed = payloadSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Webhook payload is invalid" });
  const replayKey = `identity:webhook:${provider.data}:${parsed.data.event_id}`;
  let inserted: "OK" | null;
  try {
    inserted = await redis.set(replayKey, "1", "EX", 24 * 60 * 60, "NX");
  } catch {
    return reply.status(503).send({ error: "Webhook replay protection is unavailable" });
  }
  if (!inserted) return reply.send({ success: true, idempotent: true });
  const config = await siteConfig.getConfig(parsed.data.site_id);
  if (!config) return reply.status(404).send({ error: "Site not found" });
  let correlation: { anonymousSubject: string; receiptId: string };
  try {
    correlation = verifyCorrelationToken({
      token: parsed.data.correlation_token,
      expectedSitePublicId: parsed.data.site_id,
    });
  } catch {
    return reply.status(401).send({ error: "Correlation token is invalid" });
  }
  const [consent] = await db
    .select({ id: identityConsentReceipts.id })
    .from(identityConsentReceipts)
    .where(
      and(
        eq(identityConsentReceipts.id, correlation.receiptId),
        eq(identityConsentReceipts.siteId, config.siteId),
        eq(identityConsentReceipts.anonymousSubject, correlation.anonymousSubject),
        eq(identityConsentReceipts.granted, true),
        isNull(identityConsentReceipts.withdrawnAt)
      )
    )
    .limit(1);
  if (!consent) return reply.status(403).send({ error: "Consent is not active" });
  const normalized = normalizeProviderResponse(provider.data, parsed.data.result);
  const result = await identityResolutionService.ingestWebhookCandidates({
    siteId: config.siteId,
    sitePublicId: parsed.data.site_id,
    anonymousSubject: correlation.anonymousSubject,
    provider: provider.data,
    providerRequestId: normalized.requestId || parsed.data.event_id,
    candidates: normalized.candidates,
  });
  return reply.status(result.accepted ? 202 : 403).send({ success: result.accepted, ...result });
}
