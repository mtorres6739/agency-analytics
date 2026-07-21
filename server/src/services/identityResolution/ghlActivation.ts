import type { IdentityCandidateRecord } from "@rybbit/shared";

export async function sendCandidateToGhl(candidate: Pick<IdentityCandidateRecord, "siteId" | "traits">) {
  let jsonCredential: { accessToken?: string; locationId?: string } | undefined;
  try {
    const configured = JSON.parse(process.env.GHL_SITE_CREDENTIALS_JSON || "{}") as Record<
      string,
      { accessToken?: string; locationId?: string }
    >;
    jsonCredential = configured[String(candidate.siteId)];
  } catch {
    jsonCredential = undefined;
  }
  const token = process.env[`GHL_SITE_${candidate.siteId}_ACCESS_TOKEN`]?.trim() || jsonCredential?.accessToken?.trim();
  const locationId =
    process.env[`GHL_SITE_${candidate.siteId}_LOCATION_ID`]?.trim() || jsonCredential?.locationId?.trim();
  if (!token || !locationId) return { status: "not_configured" as const, contactId: null };
  if (!candidate.traits.email) return { status: "missing_email" as const, contactId: null };

  const [firstName, ...lastParts] = (candidate.traits.name || "").trim().split(/\s+/);
  const response = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      version: "2021-07-28",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      locationId,
      email: candidate.traits.email,
      ...(firstName ? { firstName } : {}),
      ...(lastParts.length ? { lastName: lastParts.join(" ") } : {}),
      ...(candidate.traits.company ? { companyName: candidate.traits.company } : {}),
      source: "SDM Agency Analytics identity review",
      tags: ["agency-analytics-reviewed"],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return { status: "failed" as const, contactId: null };
  const result = (await response.json()) as { contact?: { id?: string } };
  return { status: "sent" as const, contactId: result.contact?.id ?? null };
}
