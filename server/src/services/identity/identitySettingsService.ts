import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { IdentitySettings, IdentityTraitKey } from "@rybbit/shared";
import { db } from "../../db/postgres/postgres.js";
import { siteIdentityKeys, siteIdentitySettings } from "../../db/postgres/schema.js";
import { decryptIdentitySecret, encryptIdentitySecret, generateIdentitySecret } from "./identityCrypto.js";

export const DEFAULT_IDENTITY_TRAITS: IdentityTraitKey[] = [
  "name",
  "email",
  "company",
  "plan",
  "title",
  "linkedinUrl",
  "location",
];

export function serializeIdentitySettings(
  siteId: number,
  settings?: typeof siteIdentitySettings.$inferSelect,
  key?: typeof siteIdentityKeys.$inferSelect,
  latestKey?: typeof siteIdentityKeys.$inferSelect
): IdentitySettings {
  const now = new Date().toISOString();
  const displayKey = latestKey ?? key;
  return {
    siteId,
    enabled: settings?.enabled ?? false,
    mode: (settings?.mode as "signed" | "direct") ?? "signed",
    allowedTraits: (settings?.allowedTraits as IdentityTraitKey[] | undefined) ?? DEFAULT_IDENTITY_TRAITS,
    retentionDays: settings?.retentionDays ?? 395,
    keyVersion: displayKey?.version ?? null,
    keyConfigured: !!settings?.activeKeyId,
    rotationStatus:
      displayKey?.status === "pending"
        ? "pending"
        : displayKey?.status === "revoked" && !settings?.activeKeyId
          ? "failed"
          : settings?.activeKeyId
            ? "active"
            : "unconfigured",
    deploymentProvider:
      displayKey?.deploymentProvider === "vercel" ||
      displayKey?.deploymentProvider === "wordpress" ||
      displayKey?.deploymentProvider === "manual"
        ? displayKey.deploymentProvider
        : null,
    deploymentProject: displayKey?.deploymentProject ?? null,
    complianceBlocked: false,
    complianceReason: null,
    lastSuccessAt: settings?.lastSuccessAt ?? null,
    lastFailureAt: settings?.lastFailureAt ?? null,
    createdAt: settings?.createdAt ?? now,
    updatedAt: settings?.updatedAt ?? now,
  };
}

export async function getIdentitySettingsRecord(siteId: number) {
  const [settings] = await db
    .select()
    .from(siteIdentitySettings)
    .where(eq(siteIdentitySettings.siteId, siteId))
    .limit(1);
  if (!settings) return { settings: undefined, key: undefined, latestKey: undefined };
  const [key] = settings.activeKeyId
    ? await db.select().from(siteIdentityKeys).where(eq(siteIdentityKeys.id, settings.activeKeyId)).limit(1)
    : [];
  const [latestKey] = await db
    .select()
    .from(siteIdentityKeys)
    .where(eq(siteIdentityKeys.siteId, siteId))
    .orderBy(desc(siteIdentityKeys.version))
    .limit(1);
  return { settings, key, latestKey };
}

export async function getActiveIdentitySecret(siteId: number) {
  const { settings, key } = await getIdentitySettingsRecord(siteId);
  if (!settings?.enabled || settings.mode !== "signed" || !key || key.status !== "active") return null;
  return { settings, key, secret: decryptIdentitySecret(key) };
}

export async function getIdentityVerificationSecrets(siteId: number) {
  const { settings, key } = await getIdentitySettingsRecord(siteId);
  if (!settings?.enabled || settings.mode !== "signed" || !key || key.status !== "active") return null;
  const gracePeriodStart = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const retired = await db
    .select()
    .from(siteIdentityKeys)
    .where(
      and(
        eq(siteIdentityKeys.siteId, siteId),
        eq(siteIdentityKeys.status, "retired"),
        sql`${siteIdentityKeys.retiredAt} >= ${gracePeriodStart}`
      )
    )
    .orderBy(desc(siteIdentityKeys.version))
    .limit(1);
  return {
    settings,
    keys: [key, ...retired].map(value => ({ key: value, secret: decryptIdentitySecret(value) })),
  };
}

export async function prepareIdentityKey(siteId: number) {
  const secret = generateIdentitySecret();
  const encrypted = encryptIdentitySecret(secret);
  const now = new Date().toISOString();
  return db.transaction(async tx => {
    const [latest] = await tx
      .select({ version: siteIdentityKeys.version })
      .from(siteIdentityKeys)
      .where(eq(siteIdentityKeys.siteId, siteId))
      .orderBy(desc(siteIdentityKeys.version))
      .limit(1);
    const version = (latest?.version ?? 0) + 1;
    const id = randomUUID();
    await tx
      .update(siteIdentityKeys)
      .set({ status: "revoked", revokedAt: now })
      .where(and(eq(siteIdentityKeys.siteId, siteId), eq(siteIdentityKeys.status, "pending")));
    await tx.insert(siteIdentityKeys).values({ id, siteId, version, ...encrypted, status: "pending", createdAt: now });
    await tx
      .insert(siteIdentitySettings)
      .values({ siteId, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: siteIdentitySettings.siteId,
        set: { updatedAt: now },
      });
    return { id, version, secret };
  });
}

export async function recordIdentityKeyDeployment(input: {
  keyId: string;
  provider: "vercel" | "wordpress" | "manual";
  project: string;
  deploymentId: string;
}) {
  await db
    .update(siteIdentityKeys)
    .set({
      deploymentProvider: input.provider,
      deploymentProject: input.project,
      deploymentId: input.deploymentId,
    })
    .where(and(eq(siteIdentityKeys.id, input.keyId), eq(siteIdentityKeys.status, "pending")));
}

export async function activateIdentityKey(siteId: number, keyId: string) {
  const now = new Date().toISOString();
  await db.transaction(async tx => {
    const [activated] = await tx
      .update(siteIdentityKeys)
      .set({ status: "active", deployedAt: now })
      .where(
        and(
          eq(siteIdentityKeys.id, keyId),
          eq(siteIdentityKeys.siteId, siteId),
          eq(siteIdentityKeys.status, "pending")
        )
      )
      .returning({ id: siteIdentityKeys.id });
    if (!activated) {
      throw new Error("Identity key is no longer pending for this site");
    }
    await tx
      .update(siteIdentityKeys)
      .set({ status: "retired", retiredAt: now })
      .where(
        and(
          eq(siteIdentityKeys.siteId, siteId),
          eq(siteIdentityKeys.status, "active"),
          sql`${siteIdentityKeys.id} <> ${keyId}`
        )
      );
    await tx
      .update(siteIdentitySettings)
      .set({ activeKeyId: keyId, updatedAt: now })
      .where(eq(siteIdentitySettings.siteId, siteId));
  });
}

export async function failIdentityKey(keyId: string) {
  const now = new Date().toISOString();
  await db
    .update(siteIdentityKeys)
    .set({ status: "revoked", revokedAt: now })
    .where(and(eq(siteIdentityKeys.id, keyId), inArray(siteIdentityKeys.status, ["pending", "active"])));
}

export async function markIdentityResult(siteId: number, success: boolean) {
  const now = new Date().toISOString();
  await db
    .update(siteIdentitySettings)
    .set(success ? { lastSuccessAt: now, updatedAt: now } : { lastFailureAt: now, updatedAt: now })
    .where(eq(siteIdentitySettings.siteId, siteId));
}

export async function touchIdentityKey(keyId: string) {
  await db
    .update(siteIdentityKeys)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(siteIdentityKeys.id, keyId));
}
