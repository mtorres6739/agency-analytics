const LOCKED_COMPLIANCE_DOMAINS: Record<string, string> = {
  "theaccidentdoctor.com": "Medical compliance approval is required before identity can be enabled",
  "neuron-connect.com": "Medical compliance approval is required before identity can be enabled",
  "arizonatattooremoval.com": "Health-data privacy approval is required before identity can be enabled",
  "r2law.co": "Attorney-privacy approval is required before identity can be enabled",
  "cummingspest.com": "Real CRM delivery must replace the simulated form success path before identity can be enabled",
};

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

export function getIdentityComplianceBlock(domain: string) {
  const normalized = normalizeDomain(domain);
  const extraBlocked = new Set(
    String(process.env.IDENTITY_BLOCKED_DOMAINS ?? "")
      .split(",")
      .map(normalizeDomain)
      .filter(Boolean)
  );
  if (extraBlocked.has(normalized)) {
    return "Identity is blocked by the server compliance policy for this domain";
  }
  return LOCKED_COMPLIANCE_DOMAINS[normalized] ?? null;
}
