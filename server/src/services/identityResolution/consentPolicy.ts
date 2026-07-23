export type IdentityConsentDecision = {
  granted: boolean;
  gpc: boolean;
  eligibleRegion: boolean;
  code: "GRANTED" | "GPC" | "REGION_NOT_ELIGIBLE" | "REJECTED";
};

export function decideIdentityConsent(input: {
  requested: boolean;
  headerGpc: boolean;
  clientGpc: boolean;
  categories: string[];
  countryIso?: string | null;
}): IdentityConsentDecision {
  const gpc = input.headerGpc || input.clientGpc;
  const eligibleRegion = input.countryIso?.toUpperCase() === "US";
  const granted = input.requested && !gpc && eligibleRegion && input.categories.includes("identification");
  return {
    granted,
    gpc,
    eligibleRegion,
    code: granted ? "GRANTED" : gpc ? "GPC" : input.requested && !eligibleRegion ? "REGION_NOT_ELIGIBLE" : "REJECTED",
  };
}
