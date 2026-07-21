export const identityModes = ["signed", "direct"] as const;
export type IdentityMode = (typeof identityModes)[number];

export const identityTraitKeys = ["name", "email", "company", "plan"] as const;
export type IdentityTraitKey = (typeof identityTraitKeys)[number];

export interface IdentityTraits {
  name?: string;
  email?: string;
  company?: string;
  plan?: string;
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
