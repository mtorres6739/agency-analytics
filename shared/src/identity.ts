export const identityModes = ["signed", "direct"] as const;
export type IdentityMode = (typeof identityModes)[number];

export const identityTraitKeys = ["name", "email", "company", "plan", "title", "linkedinUrl", "location"] as const;
export type IdentityTraitKey = (typeof identityTraitKeys)[number];

export interface IdentityTraits {
  name?: string;
  email?: string;
  company?: string;
  plan?: string;
  title?: string;
  linkedinUrl?: string;
  location?: string;
}

export interface IdentityAssertionClaims {
  v: 1;
  iss: string;
  sub: string;
  traits: IdentityTraits;
  iat: number;
  exp: number;
  jti: string;
}

export interface IdentitySettings {
  siteId: number;
  enabled: boolean;
  mode: IdentityMode;
  allowedTraits: IdentityTraitKey[];
  retentionDays: number;
  keyVersion: number | null;
  keyConfigured: boolean;
  rotationStatus: "unconfigured" | "pending" | "active" | "failed";
  deploymentProvider: "vercel" | "wordpress" | "manual" | null;
  deploymentProject: string | null;
  complianceBlocked: boolean;
  complianceReason: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityAdapterStatus {
  supported: boolean;
  installed: boolean;
  enabled: boolean;
  blocker?: string;
  lastVerifiedAt?: string | null;
}

export const identityProviders = ["customers_ai", "rb2b"] as const;
export type IdentityProvider = (typeof identityProviders)[number];

export const enrichmentProviders = ["pdl"] as const;
export type EnrichmentProviderName = (typeof enrichmentProviders)[number];

export type IdentityResolutionMode = "consumer" | "business";
export type IdentityMatchMethod = "deterministic" | "probabilistic";
export type IdentityCandidateStatus = "pending" | "approved" | "rejected" | "suppressed" | "expired";

export interface FieldProvenance {
  field: keyof IdentityTraits;
  provider: IdentityProvider | EnrichmentProviderName | "first_party";
  confidence: number;
  observedAt: string;
}

export interface ResolutionContext {
  siteId: number;
  sitePublicId: string;
  anonymousSubject: string;
  correlationToken: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface ResolutionCandidate {
  providerSubjectId: string;
  confidence: number;
  matchMethod: IdentityMatchMethod;
  traits: Pick<IdentityTraits, "name" | "email" | "company" | "title" | "linkedinUrl" | "location">;
  provenance: FieldProvenance[];
}

export interface IdentityHints {
  name?: string;
  email?: string;
  company?: string;
  linkedinUrl?: string;
  location?: string;
}

export interface EnrichmentResult {
  traits: ResolutionCandidate["traits"];
  provenance: FieldProvenance[];
}

export interface SiteResolutionSettings {
  siteId: number;
  enabled: boolean;
  mode: IdentityResolutionMode;
  primaryProvider: IdentityProvider;
  transport: "server" | "pixel";
  enrichmentProvider: EnrichmentProviderName | null;
  enrichmentEnabled: boolean;
  shadowMode: boolean;
  deterministicThreshold: number;
  enrichmentThreshold: number;
  dailyCap: number;
  monthlyBudgetCents: number;
  complianceState: "pending" | "approved" | "blocked";
  policyVersion: string;
  phoneEnabled: false;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityCandidateRecord {
  id: string;
  siteId: number;
  provider: IdentityProvider;
  confidence: number;
  matchMethod: IdentityMatchMethod;
  traits: ResolutionCandidate["traits"];
  provenance: FieldProvenance[];
  reviewStatus: IdentityCandidateStatus;
  linkedUserId: string | null;
  crmContactId: string | null;
  createdAt: string;
  expiresAt: string;
}
