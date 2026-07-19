export const agencyClientStatuses = ["onboarding", "active", "paused", "archived"] as const;
export type AgencyClientStatus = (typeof agencyClientStatuses)[number];

export const trackingMethods = ["script", "gtm", "cms", "proxy"] as const;
export type TrackingMethod = (typeof trackingMethods)[number];

export const trackingStatuses = ["pending", "verified", "stale", "error"] as const;
export type TrackingStatus = (typeof trackingStatuses)[number];

export interface AgencyClientSite {
  clientId: string;
  siteId: number;
  name: string;
  domain: string;
  isPrimary: boolean;
  trackingMethod: TrackingMethod;
  trackingStatus: TrackingStatus;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
}

export interface AgencyClient {
  id: string;
  organizationId: string;
  teamId: string;
  name: string;
  slug: string;
  status: AgencyClientStatus;
  logoUrl: string | null;
  timezone: string;
  externalRef: string | null;
  createdAt: string;
  updatedAt: string;
  sites: AgencyClientSite[];
}

export interface ClientSummary {
  clientId: string;
  siteCount: number;
  visitors: number;
  sessions: number;
  conversions: number;
  conversionRate: number;
  sitesDown: number;
  trackingIssues: number;
  reportingPeriod: { start: string; end: string };
  partialData?: string[];
}

export interface OnboardingState {
  clientId: string;
  completedSteps: number;
  totalSteps: number;
  percentComplete: number;
  steps: Array<{
    key:
      | "client"
      | "site"
      | "installation"
      | "privacy"
      | "verification"
      | "goals"
      | "integrations"
      | "users"
      | "reporting";
    label: string;
    complete: boolean;
  }>;
}

export const reportCadences = ["weekly", "monthly"] as const;
export type ReportCadence = (typeof reportCadences)[number];

export interface ReportRecipient {
  id: string;
  scheduleId: string;
  name: string;
  email: string;
  locale: string;
  enabled: boolean;
}

export interface ReportSchedule {
  id: string;
  clientId: string;
  name: string;
  cadence: ReportCadence;
  timezone: string;
  weekday: number | null;
  dayOfMonth: number | null;
  sendHour: number;
  siteScope: number[];
  enabled: boolean;
  nextRunAt: string | null;
  recipients: ReportRecipient[];
}

export const reportRunStatuses = ["queued", "running", "succeeded", "failed"] as const;
export type ReportRunStatus = (typeof reportRunStatuses)[number];

export interface ReportRun {
  id: string;
  scheduleId: string;
  windowStart: string;
  windowEnd: string;
  status: ReportRunStatus;
  summary: Record<string, unknown>;
  artifactAvailable: boolean;
  attempts: number;
  errorSummary: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ApiErrorEnvelope {
  error: string;
  code?: string;
  details?: Record<string, string[]>;
}
