import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/postgres/postgres.js";
import { siteIdentityKeys } from "../../db/postgres/schema.js";
import {
  activateIdentityKey,
  failIdentityKey,
  prepareIdentityKey,
  recordIdentityKeyDeployment,
} from "./identitySettingsService.js";
import { createVercelIdentityProvisioner } from "./vercelIdentityProvisioner.js";

export class IdentityProvisioningError extends Error {
  constructor(
    message: string,
    readonly code: "PROVIDER_NOT_CONFIGURED" | "UNSUPPORTED_SITE" | "DEPLOYMENT_FAILED"
  ) {
    super(message);
  }
}

export async function provisionIdentityKey(input: { siteId: number; sitePublicId: string; hostname: string }) {
  const provider = createVercelIdentityProvisioner();
  if (!provider) {
    throw new IdentityProvisioningError(
      "Vercel identity deployment credentials are not configured on the analytics server",
      "PROVIDER_NOT_CONFIGURED"
    );
  }

  const prepared = await prepareIdentityKey(input.siteId);
  try {
    const deployment = await provider.provision({
      hostname: input.hostname,
      sitePublicId: input.sitePublicId,
      secret: prepared.secret,
    });
    await recordIdentityKeyDeployment({
      keyId: prepared.id,
      provider: "vercel",
      project: deployment.projectName,
      deploymentId: deployment.deploymentId,
    });
    return {
      keyId: prepared.id,
      keyVersion: prepared.version,
      status: "pending" as const,
      provider: "vercel" as const,
      project: deployment.projectName,
      deploymentId: deployment.deploymentId,
    };
  } catch (error) {
    await failIdentityKey(prepared.id);
    const message = error instanceof Error ? error.message : "Identity deployment failed";
    const code = /No supported Vercel project/.test(message) ? "UNSUPPORTED_SITE" : "DEPLOYMENT_FAILED";
    throw new IdentityProvisioningError(message, code);
  }
}

export async function refreshPendingIdentityKey(siteId: number) {
  const [pending] = await db
    .select()
    .from(siteIdentityKeys)
    .where(and(eq(siteIdentityKeys.siteId, siteId), eq(siteIdentityKeys.status, "pending")))
    .orderBy(desc(siteIdentityKeys.version))
    .limit(1);
  if (!pending) return { changed: false, status: null as null };
  if (pending.deploymentProvider !== "vercel" || !pending.deploymentId) {
    await failIdentityKey(pending.id);
    return { changed: true, status: "failed" as const };
  }
  const provider = createVercelIdentityProvisioner();
  if (!provider) return { changed: false, status: "pending" as const };
  const status = await provider.status(pending.deploymentId);
  if (status === "ready") {
    await activateIdentityKey(siteId, pending.id);
    return { changed: true, status };
  }
  if (status === "failed") {
    await failIdentityKey(pending.id);
    return { changed: true, status };
  }
  return { changed: false, status };
}
