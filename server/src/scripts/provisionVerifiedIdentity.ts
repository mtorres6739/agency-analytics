import { eq } from "drizzle-orm";
import { db } from "../db/postgres/postgres.js";
import { siteIdentitySettings, sites } from "../db/postgres/schema.js";
import { getIdentityComplianceBlock } from "../services/identity/identityCompliance.js";
import { provisionIdentityKey, refreshPendingIdentityKey } from "../services/identity/identityProvisioningService.js";

const siteId = Number(process.argv[2]);
const enable = process.argv.includes("--enable");
if (!Number.isSafeInteger(siteId) || siteId <= 0) {
  console.error("Usage: node dist/scripts/provisionVerifiedIdentity.js <site-id> [--enable]");
  process.exit(1);
}

const [site] = await db.select().from(sites).where(eq(sites.siteId, siteId)).limit(1);
if (!site?.id) {
  console.error("Site or public tracking property ID not found");
  process.exit(1);
}
const complianceReason = getIdentityComplianceBlock(site.domain);
if (complianceReason) {
  console.error(`Blocked: ${complianceReason}`);
  process.exit(2);
}

const deployment = await provisionIdentityKey({
  siteId,
  sitePublicId: site.id,
  hostname: site.domain,
});
console.log(`Started ${deployment.provider} deployment for ${site.domain} (key version ${deployment.keyVersion})`);

let finalStatus: string | null = "pending";
for (let attempt = 0; attempt < 60 && finalStatus === "pending"; attempt += 1) {
  await new Promise(resolve => setTimeout(resolve, 10_000));
  const refreshed = await refreshPendingIdentityKey(siteId);
  finalStatus = refreshed.status;
  if ((attempt + 1) % 3 === 0) console.log(`Deployment status: ${finalStatus ?? "active"}`);
}
if (finalStatus !== "ready") {
  console.error(`Identity deployment did not become ready: ${finalStatus}`);
  process.exit(3);
}
if (enable) {
  await db
    .update(siteIdentitySettings)
    .set({ enabled: true, mode: "signed", updatedAt: new Date().toISOString() })
    .where(eq(siteIdentitySettings.siteId, siteId));
  console.log(`Verified identity enabled for ${site.domain}`);
} else {
  console.log(`Identity key is active for ${site.domain}; identity remains disabled`);
}
process.exit(0);
