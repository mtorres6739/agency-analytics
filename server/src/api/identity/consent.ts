import { and, eq, isNull } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { clickhouse } from "../../db/clickhouse/clickhouse.js";
import { getLocation } from "../../db/geolocation/geolocation.js";
import { db } from "../../db/postgres/postgres.js";
import {
  identityCandidates,
  identityConsentReceipts,
  identitySuppressions,
  userAliases,
  userProfiles,
} from "../../db/postgres/schema.js";
import { siteConfig } from "../../lib/siteConfig.js";
import {
  createConsentWithdrawalToken,
  deriveScopedIdentityKey,
  verifyConsentWithdrawalToken,
} from "../../services/identity/identityCrypto.js";
import { decideIdentityConsent } from "../../services/identityResolution/consentPolicy.js";
import { identityResolutionService } from "../../services/identityResolution/resolutionService.js";
import { resolveClientIp } from "../../services/tracker/resolveClientIp.js";
import { userIdService } from "../../services/userId/userIdService.js";

const consentSchema = z
  .object({
    site_id: z.string().min(1).max(64),
    granted: z.boolean(),
    gpc: z.boolean().default(false),
    categories: z.array(z.literal("identification")).max(1).default([]),
    region: z.string().trim().max(32).optional(),
  })
  .strict();

const withdrawSchema = z
  .object({ site_id: z.string().min(1).max(64), withdrawal_token: z.string().min(1).max(4096).optional() })
  .strict();

async function requestIdentity(request: FastifyRequest, publicSiteId: string, numericSiteId: number) {
  const ipAddress = resolveClientIp(request);
  const userAgent = request.headers["user-agent"] || "";
  const anonymousSubject = await userIdService.generateUserId(ipAddress, userAgent, numericSiteId);
  return { ipAddress, userAgent, anonymousSubject, publicSiteId };
}

export async function handleIdentityConsent(request: FastifyRequest, reply: FastifyReply) {
  const parsed = consentSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid consent payload", code: "INVALID_PAYLOAD" });
  const config = await siteConfig.getConfig(parsed.data.site_id);
  if (!config) return reply.status(404).send({ error: "Site not found", code: "SITE_NOT_FOUND" });
  const identity = await requestIdentity(request, parsed.data.site_id, config.siteId);
  const headerGpc = request.headers["sec-gpc"] === "1";
  const locations = await getLocation([identity.ipAddress]).catch(() => undefined);
  const countryIso = locations?.[identity.ipAddress]?.countryIso?.toUpperCase() ?? "unknown";
  const decision = decideIdentityConsent({
    requested: parsed.data.granted,
    headerGpc,
    clientGpc: parsed.data.gpc,
    categories: parsed.data.categories,
    countryIso,
  });
  const { granted } = decision;
  const [settings] = await db.query.siteResolutionSettings.findMany({
    where: (settings, { eq }) => eq(settings.siteId, config.siteId),
    limit: 1,
  });
  if (!granted) {
    await db
      .update(identityConsentReceipts)
      .set({ granted: false, permittedCategories: [], withdrawnAt: new Date().toISOString() })
      .where(
        and(
          eq(identityConsentReceipts.siteId, config.siteId),
          eq(identityConsentReceipts.anonymousSubject, identity.anonymousSubject),
          eq(identityConsentReceipts.granted, true),
          isNull(identityConsentReceipts.withdrawnAt)
        )
      );
    if (decision.gpc) {
      await db
        .insert(identitySuppressions)
        .values({
          siteId: config.siteId,
          suppressionKey: deriveScopedIdentityKey(
            parsed.data.site_id,
            "identity-suppression-v1",
            identity.anonymousSubject
          ),
          reason: "gpc",
        })
        .onConflictDoNothing();
    }
    return reply.send({ success: true, granted: false, gpc: decision.gpc, code: decision.code });
  } else {
    const [activeReceipt] = await db
      .select({ id: identityConsentReceipts.id })
      .from(identityConsentReceipts)
      .where(
        and(
          eq(identityConsentReceipts.siteId, config.siteId),
          eq(identityConsentReceipts.anonymousSubject, identity.anonymousSubject),
          eq(identityConsentReceipts.policyVersion, settings?.policyVersion ?? "identity-v1"),
          eq(identityConsentReceipts.granted, true),
          isNull(identityConsentReceipts.withdrawnAt)
        )
      )
      .limit(1);
    if (activeReceipt) {
      const withdrawalToken = createConsentWithdrawalToken({
        sitePublicId: parsed.data.site_id,
        anonymousSubject: identity.anonymousSubject,
        receiptId: activeReceipt.id,
        expiresAt: Math.floor(Date.now() / 1000) + 395 * 24 * 60 * 60,
      });
      return reply.send({
        success: true,
        granted: true,
        withdrawalToken,
        queued: false,
        code: "ALREADY_GRANTED",
      });
    }
  }
  const [receipt] = await db
    .insert(identityConsentReceipts)
    .values({
      siteId: config.siteId,
      anonymousSubject: identity.anonymousSubject,
      policyVersion: settings?.policyVersion ?? "identity-v1",
      permittedCategories: granted ? ["identification"] : [],
      region: countryIso,
      gpc: decision.gpc,
      granted,
      grantedAt: granted ? new Date().toISOString() : null,
    })
    .returning({ id: identityConsentReceipts.id });

  const withdrawalToken = createConsentWithdrawalToken({
    sitePublicId: parsed.data.site_id,
    anonymousSubject: identity.anonymousSubject,
    receiptId: receipt.id,
    expiresAt: Math.floor(Date.now() / 1000) + 395 * 24 * 60 * 60,
  });
  const queued = await identityResolutionService.queueFromConsent({
    siteId: config.siteId,
    sitePublicId: parsed.data.site_id,
    anonymousSubject: identity.anonymousSubject,
    receiptId: receipt.id,
    ipAddress: identity.ipAddress,
    userAgent: identity.userAgent,
  });
  return reply.status(queued.queued ? 202 : 200).send({ success: true, granted: true, withdrawalToken, ...queued });
}

export async function handleIdentityWithdrawal(request: FastifyRequest, reply: FastifyReply) {
  const parsed = withdrawSchema.safeParse(request.body);
  if (!parsed.success) return reply.status(400).send({ error: "Invalid withdrawal payload", code: "INVALID_PAYLOAD" });
  const config = await siteConfig.getConfig(parsed.data.site_id);
  if (!config) return reply.status(404).send({ error: "Site not found", code: "SITE_NOT_FOUND" });
  const requestSubject = await requestIdentity(request, parsed.data.site_id, config.siteId);
  let anonymousSubject = requestSubject.anonymousSubject;
  let receiptId: string | undefined;
  if (parsed.data.withdrawal_token) {
    try {
      const verified = verifyConsentWithdrawalToken({
        token: parsed.data.withdrawal_token,
        expectedSitePublicId: parsed.data.site_id,
      });
      anonymousSubject = verified.anonymousSubject;
      receiptId = verified.receiptId;
    } catch {
      return reply.status(400).send({ error: "Withdrawal token is invalid", code: "INVALID_WITHDRAWAL_TOKEN" });
    }
  }
  const candidates = await db
    .select({
      id: identityCandidates.id,
      siteId: identityCandidates.siteId,
      provider: identityCandidates.provider,
      providerSubjectRef: identityCandidates.providerSubjectRef,
      linkedUserId: identityCandidates.linkedUserId,
    })
    .from(identityCandidates)
    .where(
      and(eq(identityCandidates.siteId, config.siteId), eq(identityCandidates.anonymousSubject, anonymousSubject))
    );
  const linkedUserIds = [
    ...new Set(candidates.map(row => row.linkedUserId).filter((value): value is string => !!value)),
  ];
  const suppressionKey = deriveScopedIdentityKey(parsed.data.site_id, "identity-suppression-v1", anonymousSubject);
  const now = new Date().toISOString();
  let deletionOutboxIds: string[] = [];
  await db.transaction(async tx => {
    deletionOutboxIds = (await identityResolutionService.stageProviderDeletions(candidates, tx)).map(
      record => record.id
    );
    await tx
      .update(identityConsentReceipts)
      .set({ granted: false, permittedCategories: [], withdrawnAt: now })
      .where(
        and(
          eq(identityConsentReceipts.siteId, config.siteId),
          eq(identityConsentReceipts.anonymousSubject, anonymousSubject),
          ...(receiptId ? [eq(identityConsentReceipts.id, receiptId)] : []),
          isNull(identityConsentReceipts.withdrawnAt)
        )
      );
    await tx
      .delete(identityCandidates)
      .where(
        and(eq(identityCandidates.siteId, config.siteId), eq(identityCandidates.anonymousSubject, anonymousSubject))
      );
    await tx
      .delete(userAliases)
      .where(and(eq(userAliases.siteId, config.siteId), eq(userAliases.anonymousId, anonymousSubject)));
    for (const linkedUserId of linkedUserIds) {
      await tx
        .delete(userProfiles)
        .where(and(eq(userProfiles.siteId, config.siteId), eq(userProfiles.userId, linkedUserId)));
      await tx
        .delete(userAliases)
        .where(and(eq(userAliases.siteId, config.siteId), eq(userAliases.userId, linkedUserId)));
    }
    await tx
      .insert(identitySuppressions)
      .values({ siteId: config.siteId, suppressionKey, reason: "withdrawn" })
      .onConflictDoNothing();
  });
  const providerDeletionsQueued = await identityResolutionService.dispatchProviderDeletions(deletionOutboxIds);
  const userIds = [anonymousSubject, ...linkedUserIds];
  await Promise.all(
    ["events", "session_replay_events", "session_replay_metadata"].map(table =>
      clickhouse.command({
        query: `DELETE FROM ${table} WHERE site_id = {siteId:UInt16} AND (user_id IN ({userIds:Array(String)}) OR identified_user_id IN ({userIds:Array(String)}))`,
        query_params: { siteId: config.siteId, userIds },
      })
    )
  );
  return reply.send({ success: true, suppressed: true, providerDeletionsQueued });
}
