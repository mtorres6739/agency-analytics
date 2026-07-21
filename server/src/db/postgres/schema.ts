import { sql } from "drizzle-orm";
import type { DashboardConfig } from "@rybbit/shared";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  unique,
  pgEnum,
  uuid,
} from "drizzle-orm/pg-core";

// User table (BetterAuth)
export const user = pgTable(
  "user",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    username: text(),
    email: text().notNull(),
    emailVerified: boolean().notNull(),
    image: text(),
    createdAt: timestamp({ mode: "string" }).notNull(),
    updatedAt: timestamp({ mode: "string" }).notNull(),
    role: text().default("user").notNull(),
    displayUsername: text(),
    banned: boolean(),
    banReason: text(),
    banExpires: timestamp({ mode: "string" }),
    // deprecated
    stripeCustomerId: text(),
    // deprecated
    overMonthlyLimit: boolean().default(false),
    // deprecated
    monthlyEventCount: integer().default(0),
    sendAutoEmailReports: boolean().default(true),
    twoFactorEnabled: boolean().default(false),
    scheduledTipEmailIds: jsonb("scheduled_tip_email_ids").$type<string[]>().default([]),
  },
  table => [unique("user_username_unique").on(table.username), unique("user_email_unique").on(table.email)]
);

// Better Auth TOTP and backup-code state. Secrets and backup codes are
// encrypted by Better Auth with BETTER_AUTH_SECRET before they reach this
// table and are never returned through the session model.
export const twoFactor = pgTable(
  "twoFactor",
  {
    id: text().primaryKey().notNull(),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean().default(false).notNull(),
    failedVerificationCount: integer().default(0).notNull(),
    lockedUntil: timestamp({ mode: "string" }),
  },
  table => [unique("twoFactor_userId_unique").on(table.userId), index("twoFactor_secret_idx").on(table.secret)]
);

// Verification table (BetterAuth)
export const verification = pgTable("verification", {
  id: text().primaryKey().notNull(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp({ mode: "string" }).notNull(),
  createdAt: timestamp({ mode: "string" }),
  updatedAt: timestamp({ mode: "string" }),
});

// Sites table
export const sites = pgTable(
  "sites",
  {
    id: text("id").$defaultFn(() => sql`encode(gen_random_bytes(6), 'hex')`),
    // deprecated - keeping as primary key for backwards compatibility
    siteId: serial("site_id").primaryKey().notNull(),
    name: text("name").notNull(),
    type: text("type").$type<"web" | "mobile" | null>(),
    domain: text("domain").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    organizationId: text("organization_id").references(() => organization.id),
    public: boolean().default(false),
    embedEnabled: boolean("embed_enabled").default(false),
    saltUserIds: boolean().default(false),
    blockBots: boolean().default(true).notNull(),
    excludedIPs: jsonb("excluded_ips").default([]), // Array of IP addresses/ranges to exclude
    excludedCountries: jsonb("excluded_countries").default([]), // Array of ISO country codes to exclude (e.g., ["US", "GB"])
    excludedPaths: jsonb("excluded_paths").default([]).$type<string[]>(), // Array of pathname glob patterns to exclude (e.g., ["/admin/*", "/preview"])
    excludedHostnames: jsonb("excluded_hostnames").default([]).$type<string[]>(), // Array of hostname glob patterns to exclude (e.g., ["localhost", "*.vercel.app"])
    excludedUserAgents: jsonb("excluded_user_agents").default([]).$type<string[]>(), // Array of case-insensitive user-agent substrings to exclude (e.g., ["HeadlessChrome"])
    sessionReplay: boolean().default(false),
    webVitals: boolean().default(false),
    trackErrors: boolean().default(false),
    trackOutbound: boolean().default(true),
    trackUrlParams: boolean().default(true),
    trackInitialPageView: boolean().default(true),
    trackSpaNavigation: boolean().default(true),
    trackIp: boolean().default(false),
    trackButtonClicks: boolean().default(false),
    trackCopy: boolean().default(false),
    trackFormInteractions: boolean().default(false),
    apiKey: text("api_key"), // Format: rb_{64_hex_chars} = 67 chars total
    privateLinkKey: text("private_link_key"),
    tags: jsonb("tags").default([]).$type<string[]>(),
  },
  table => [check("sites_type_check", sql`${table.type} IS NULL OR ${table.type} IN ('web', 'mobile')`)]
);

// Active sessions table.
// DEPRECATED: session tracking moved to Redis (see services/sessions/sessionsService.ts).
// No longer read or written by the app; kept so existing deployments stay drift-free.
// Drop it once Redis-backed sessions are verified in production:
//   DROP TABLE IF EXISTS active_sessions;
export const activeSessions = pgTable("active_sessions", {
  sessionId: text("session_id").primaryKey().notNull(),
  siteId: integer("site_id"),
  userId: text("user_id"),
  startTime: timestamp("start_time").defaultNow(),
  lastActivity: timestamp("last_activity").defaultNow(),
});

export const funnels = pgTable("funnels", {
  reportId: serial("report_id").primaryKey().notNull(),
  siteId: integer("site_id").references(() => sites.siteId, { onDelete: "cascade" }),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  data: jsonb(),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow(),
});

export const dashboards = pgTable("dashboards", {
  dashboardId: serial("dashboard_id").primaryKey().notNull(),
  siteId: integer("site_id").references(() => sites.siteId, { onDelete: "cascade" }),
  userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  config: jsonb("config").notNull().$type<DashboardConfig>().default({ cards: [] }),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow(),
});

// Account table (BetterAuth)
export const account = pgTable("account", {
  id: text().primaryKey().notNull(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: timestamp({ mode: "string" }),
  refreshTokenExpiresAt: timestamp({ mode: "string" }),
  scope: text(),
  password: text(),
  createdAt: timestamp({ mode: "string" }).notNull(),
  updatedAt: timestamp({ mode: "string" }).notNull(),
});

// Organization table (BetterAuth)
export const organization = pgTable(
  "organization",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    slug: text().notNull(),
    logo: text(),
    createdAt: timestamp({ mode: "string" }).notNull(),
    metadata: text(),
    stripeCustomerId: text(),
    monthlyEventCount: integer().default(0),
    overMonthlyLimit: boolean().default(false),
    approachingLimitNotifiedPeriodStart: text(),
    planOverride: text(), // Plan name override (e.g., "pro1m", "standard500k")
    customPlan: jsonb("custom_plan").$type<{
      events: number;
      members: number | null; // null = unlimited
      websites: number | null; // null = unlimited
    }>(),
  },
  table => [unique("organization_slug_unique").on(table.slug)]
);

// Member table (BetterAuth)
export const member = pgTable("member", {
  id: text().primaryKey().notNull(),
  organizationId: text()
    .notNull()
    .references(() => organization.id),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  role: text().notNull(),
  createdAt: timestamp({ mode: "string" }).notNull(),
  // Site access restriction: false = all sites (default), true = only sites in member_site_access
  hasRestrictedSiteAccess: boolean("has_restricted_site_access").default(false).notNull(),
});

// Invitation table (BetterAuth)
export const invitation = pgTable("invitation", {
  id: text().primaryKey().notNull(),
  email: text().notNull(),
  inviterId: text().references(() => user.id, { onDelete: "set null" }),
  organizationId: text()
    .notNull()
    .references(() => organization.id),
  role: text().notNull(),
  status: text().notNull(),
  createdAt: timestamp({ mode: "string" }),
  expiresAt: timestamp({ mode: "string" }).notNull(),
  // Site access restriction for the invited member
  hasRestrictedSiteAccess: boolean("has_restricted_site_access").default(false).notNull(),
  siteIds: jsonb("site_ids").default([]).$type<number[]>(), // Array of site IDs to grant access to
  teamId: text().references(() => team.id, { onDelete: "set null" }),
});

// Member site access junction table - stores which sites a member has access to
// Only used when member.hasRestrictedSiteAccess = true
export const memberSiteAccess = pgTable(
  "member_site_access",
  {
    id: serial("id").primaryKey().notNull(),
    memberId: text("member_id")
      .notNull()
      .references(() => member.id, { onDelete: "cascade" }),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.siteId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
  },
  table => [
    unique("member_site_access_unique").on(table.memberId, table.siteId),
    index("member_site_access_member_idx").on(table.memberId),
    index("member_site_access_site_idx").on(table.siteId),
  ]
);

// Team table (BetterAuth)
export const team = pgTable("team", {
  id: text().primaryKey(),
  name: text().notNull(),
  organizationId: text()
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" }),
  createdAt: timestamp({ mode: "string" }).notNull(),
  updatedAt: timestamp({ mode: "string" }),
});

// Team member table (BetterAuth)
export const teamMember = pgTable("teamMember", {
  id: text().primaryKey(),
  teamId: text()
    .notNull()
    .references(() => team.id, { onDelete: "cascade" }),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp({ mode: "string" }),
});

// Team site access junction table - stores which sites belong to a team
export const teamSiteAccess = pgTable(
  "team_site_access",
  {
    id: serial("id").primaryKey().notNull(),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.siteId, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  table => [
    unique("team_site_access_unique").on(table.teamId, table.siteId),
    index("team_site_access_team_idx").on(table.teamId),
    index("team_site_access_site_idx").on(table.siteId),
  ]
);

// Agency layer. A client owns one Better Auth team, while team/member site
// access remains the authorization source of truth.
export const agencyClients = pgTable(
  "agency_clients",
  {
    id: text("id").primaryKey().notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    teamId: text("team_id")
      .notNull()
      .references(() => team.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: text("status").notNull().default("onboarding"),
    logoUrl: text("logo_url"),
    timezone: text("timezone").notNull().default("UTC"),
    externalRef: text("external_ref"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  table => [
    unique("agency_clients_org_slug_unique").on(table.organizationId, table.slug),
    unique("agency_clients_team_unique").on(table.teamId),
    index("agency_clients_org_idx").on(table.organizationId),
    check("agency_clients_status_check", sql`${table.status} IN ('onboarding', 'active', 'paused', 'archived')`),
  ]
);

export const agencyClientSites = pgTable(
  "agency_client_sites",
  {
    id: serial("id").primaryKey().notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => agencyClients.id, { onDelete: "cascade" }),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.siteId, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    trackingMethod: text("tracking_method").notNull().default("script"),
    trackingStatus: text("tracking_status").notNull().default("pending"),
    verifiedAt: timestamp("verified_at", { mode: "string" }),
    lastCheckedAt: timestamp("last_checked_at", { mode: "string" }),
  },
  table => [
    unique("agency_client_sites_site_unique").on(table.siteId),
    unique("agency_client_sites_client_site_unique").on(table.clientId, table.siteId),
    index("agency_client_sites_client_idx").on(table.clientId),
    check("agency_client_sites_method_check", sql`${table.trackingMethod} IN ('script', 'gtm', 'cms', 'proxy')`),
    check(
      "agency_client_sites_status_check",
      sql`${table.trackingStatus} IN ('pending', 'verified', 'stale', 'error')`
    ),
  ]
);

// Durable state for privileged tracking installations. Provider credentials
// are never stored here; input and result contain only public site metadata and
// sanitized deployment output.
export const trackingDeployments = pgTable(
  "tracking_deployments",
  {
    id: text("id").primaryKey().notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: text("client_id")
      .notNull()
      .references(() => agencyClients.id, { onDelete: "cascade" }),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.siteId, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    action: text("action").notNull(),
    status: text("status").notNull().default("queued"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
    errorSummary: text("error_summary"),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { mode: "string" }),
    completedAt: timestamp("completed_at", { mode: "string" }),
  },
  table => [
    index("tracking_deployments_site_created_idx").on(table.siteId, table.createdAt),
    index("tracking_deployments_client_idx").on(table.clientId),
    index("tracking_deployments_status_idx").on(table.status),
    check(
      "tracking_deployments_provider_check",
      sql`${table.provider} IN ('cloudflare', 'vercel', 'wordpress', 'manual')`
    ),
    check("tracking_deployments_action_check", sql`${table.action} IN ('plan', 'apply', 'status', 'rollback')`),
    check(
      "tracking_deployments_status_check",
      sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed', 'blocked')`
    ),
  ]
);

export const reportSchedules = pgTable(
  "report_schedules",
  {
    id: text("id").primaryKey().notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => agencyClients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    cadence: text("cadence").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    weekday: integer("weekday"),
    dayOfMonth: integer("day_of_month"),
    sendHour: integer("send_hour").notNull().default(8),
    siteScope: jsonb("site_scope").$type<number[]>().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  table => [
    index("report_schedules_client_idx").on(table.clientId),
    index("report_schedules_next_run_idx").on(table.nextRunAt),
    check("report_schedules_cadence_check", sql`${table.cadence} IN ('weekly', 'monthly')`),
    check("report_schedules_weekday_check", sql`${table.weekday} IS NULL OR (${table.weekday} BETWEEN 0 AND 6)`),
    check("report_schedules_day_check", sql`${table.dayOfMonth} IS NULL OR (${table.dayOfMonth} BETWEEN 1 AND 28)`),
    check("report_schedules_hour_check", sql`${table.sendHour} BETWEEN 0 AND 23`),
  ]
);

export const reportRecipients = pgTable(
  "report_recipients",
  {
    id: text("id").primaryKey().notNull(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => reportSchedules.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    locale: text("locale").notNull().default("en"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  table => [
    unique("report_recipients_schedule_email_unique").on(table.scheduleId, table.email),
    index("report_recipients_schedule_idx").on(table.scheduleId),
  ]
);

export const reportRuns = pgTable(
  "report_runs",
  {
    id: text("id").primaryKey().notNull(),
    scheduleId: text("schedule_id")
      .notNull()
      .references(() => reportSchedules.id, { onDelete: "cascade" }),
    windowStart: timestamp("window_start", { mode: "string" }).notNull(),
    windowEnd: timestamp("window_end", { mode: "string" }).notNull(),
    status: text("status").notNull().default("queued"),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    artifactKey: text("artifact_key"),
    attempts: integer("attempts").notNull().default(0),
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { mode: "string" }),
    completedAt: timestamp("completed_at", { mode: "string" }),
  },
  table => [
    unique("report_runs_schedule_window_unique").on(table.scheduleId, table.windowStart, table.windowEnd),
    index("report_runs_schedule_idx").on(table.scheduleId),
    index("report_runs_status_idx").on(table.status),
    check("report_runs_status_check", sql`${table.status} IN ('queued', 'running', 'succeeded', 'failed')`),
    check("report_runs_window_check", sql`${table.windowEnd} > ${table.windowStart}`),
    check("report_runs_attempts_check", sql`${table.attempts} >= 0`),
  ]
);

export const agencyAuditEvents = pgTable(
  "agency_audit_events",
  {
    id: serial("id").primaryKey().notNull(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    clientId: text("client_id").references(() => agencyClients.id, { onDelete: "set null" }),
    actorUserId: text("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  table => [
    index("agency_audit_events_org_created_idx").on(table.organizationId, table.createdAt),
    index("agency_audit_events_client_idx").on(table.clientId),
  ]
);

// Session table (BetterAuth)
export const session = pgTable(
  "session",
  {
    id: text().primaryKey().notNull(),
    expiresAt: timestamp({ mode: "string" }).notNull(),
    token: text().notNull(),
    createdAt: timestamp({ mode: "string" }).notNull(),
    updatedAt: timestamp({ mode: "string" }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text(),
    activeOrganizationId: text(),
    activeTeamId: text(),
  },
  table => [unique("session_token_unique").on(table.token)]
);

// API Key table (BetterAuth)
export const apiKey = pgTable("apikey", {
  id: text().primaryKey().notNull(),
  name: text(),
  start: text(),
  prefix: text(),
  key: text().notNull(),
  // A user id (configId NULL/"default") or an organization id (configId
  // "org") — polymorphic, so no FK. Cleanup happens in auth.ts's
  // deleteUser.afterDelete and afterDeleteOrganization hooks.
  referenceId: text().notNull(),
  refillInterval: integer(),
  refillAmount: integer(),
  lastRefillAt: timestamp({ mode: "string" }),
  enabled: boolean().notNull().default(true),
  rateLimitEnabled: boolean().notNull().default(false),
  rateLimitTimeWindow: integer(),
  rateLimitMax: integer(),
  requestCount: integer().notNull().default(0),
  remaining: integer(),
  lastRequest: timestamp({ mode: "string" }),
  expiresAt: timestamp({ mode: "string" }),
  createdAt: timestamp({ mode: "string" }).notNull(),
  updatedAt: timestamp({ mode: "string" }).notNull(),
  configId: text(),
  permissions: text(),
  metadata: jsonb(),
});

// OAuth provider tables for the MCP plugin (better-auth oidc-provider schema).
// Field names and nullability mirror better-auth's model definitions; tokens
// are validated by better-auth via auth.api.getMcpSession.
export const oauthApplication = pgTable("oauthApplication", {
  id: text().primaryKey().notNull(),
  name: text().notNull(),
  icon: text(),
  metadata: text(),
  clientId: text().notNull().unique(),
  clientSecret: text(),
  redirectUrls: text().notNull(),
  type: text().notNull(),
  disabled: boolean().default(false),
  userId: text().references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp({ mode: "string" }).notNull(),
  updatedAt: timestamp({ mode: "string" }).notNull(),
});

export const oauthAccessToken = pgTable("oauthAccessToken", {
  id: text().primaryKey().notNull(),
  accessToken: text().notNull().unique(),
  refreshToken: text().unique(),
  accessTokenExpiresAt: timestamp({ mode: "string" }).notNull(),
  refreshTokenExpiresAt: timestamp({ mode: "string" }),
  clientId: text()
    .notNull()
    .references(() => oauthApplication.clientId, { onDelete: "cascade" }),
  userId: text().references(() => user.id, { onDelete: "cascade" }),
  scopes: text().notNull(),
  createdAt: timestamp({ mode: "string" }).notNull(),
  updatedAt: timestamp({ mode: "string" }).notNull(),
});

export const oauthConsent = pgTable("oauthConsent", {
  id: text().primaryKey().notNull(),
  clientId: text()
    .notNull()
    .references(() => oauthApplication.clientId, { onDelete: "cascade" }),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  scopes: text().notNull(),
  consentGiven: boolean().notNull(),
  createdAt: timestamp({ mode: "string" }).notNull(),
  updatedAt: timestamp({ mode: "string" }).notNull(),
});

// Goals table for tracking conversion goals
export const goals = pgTable(
  "goals",
  {
    goalId: serial("goal_id").primaryKey().notNull(),
    siteId: integer("site_id").notNull(),
    name: text("name"), // Optional, user-defined name for the goal
    goalType: text("goal_type").notNull(), // 'path', 'event', 'outbound', 'button_click', 'form_submit', or 'copy'
    // Configuration specific to the goal type
    config: jsonb("config").notNull().$type<{
      // For 'path' type
      pathPattern?: string; // e.g., "/pricing", "/product/*/view", "/docs/**"
      // For 'event' type
      eventName?: string; // e.g., "signup_completed", "file_downloaded"
      // For autocapture types ('outbound', 'button_click', 'form_submit', 'copy')
      valuePattern?: string; // e.g., "https://example.com/**", "Sign Up*"
      // Property filters (for all goal types)
      eventPropertyKey?: string; // Deprecated - use propertyFilters instead
      eventPropertyValue?: string | number | boolean; // Deprecated - use propertyFilters instead
      propertyFilters?: Array<{
        key: string;
        value: string | number | boolean;
      }>; // Array of property filters to match (all must match)
    }>(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
  },
  table => [
    foreignKey({
      columns: [table.siteId],
      foreignColumns: [sites.siteId],
      name: "goals_site_id_sites_site_id_fk",
    }).onDelete("cascade"),
  ]
);

export type FeatureFlagType = "boolean" | "multivariate" | "remote_config";
export type FeatureFlagRuntime = "client" | "server" | "both";
export type ExperimentStatus = "draft" | "running" | "paused" | "completed";

export type FeatureFlagPayloadValue =
  | string
  | number
  | boolean
  | null
  | FeatureFlagPayloadValue[]
  | { [key: string]: FeatureFlagPayloadValue };

export type FeatureFlagRule = {
  field:
    | "hostname"
    | "pathname"
    | "query"
    | "referrer"
    | "language"
    | "country"
    | "region"
    | "city"
    | "device_type"
    | "user_id"
    | "trait";
  key?: string;
  operator: "equals" | "not_equals" | "contains" | "starts_with" | "ends_with" | "regex";
  value: string | number | boolean | Array<string | number | boolean>;
};

export type FeatureFlagVariant = {
  key: string;
  name?: string;
  rolloutPercentage: number;
  payload?: FeatureFlagPayloadValue;
};

export type FeatureFlagConditionSet = {
  name?: string;
  rules: FeatureFlagRule[];
  rolloutPercentage?: number;
  variants?: FeatureFlagVariant[];
  payload?: FeatureFlagPayloadValue;
};

export const featureFlags = pgTable(
  "feature_flags",
  {
    flagId: serial("flag_id").primaryKey().notNull(),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.siteId, { onDelete: "cascade" }),
    key: text("key").notNull(),
    description: text("description"),
    enabled: boolean("enabled").default(false).notNull(),
    runtime: text("runtime").default("client").notNull().$type<FeatureFlagRuntime>(),
    flagType: text("flag_type").default("boolean").notNull().$type<FeatureFlagType>(),
    payload: jsonb("payload").$type<FeatureFlagPayloadValue>(),
    variants: jsonb("variants").default([]).notNull().$type<FeatureFlagVariant[]>(),
    rolloutPercentage: integer("rollout_percentage").default(100).notNull(),
    rules: jsonb("rules").default([]).notNull().$type<FeatureFlagRule[]>(),
    conditionSets: jsonb("condition_sets").default([]).notNull().$type<FeatureFlagConditionSet[]>(),
    salt: text("salt")
      .default(sql`md5(random()::text || clock_timestamp()::text)`)
      .notNull(),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  table => [
    unique("feature_flags_site_key_unique").on(table.siteId, table.key),
    index("feature_flags_site_idx").on(table.siteId),
    check("feature_flags_rollout_check", sql`rollout_percentage >= 0 AND rollout_percentage <= 100`),
    check("feature_flags_runtime_check", sql`runtime IN ('client', 'server', 'both')`),
    check("feature_flags_type_check", sql`flag_type IN ('boolean', 'multivariate', 'remote_config')`),
  ]
);

export const experiments = pgTable(
  "experiments",
  {
    experimentId: serial("experiment_id").primaryKey().notNull(),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.siteId, { onDelete: "cascade" }),
    featureFlagId: integer("feature_flag_id")
      .notNull()
      .references(() => featureFlags.flagId, { onDelete: "cascade" }),
    primaryGoalId: integer("primary_goal_id").references(() => goals.goalId, { onDelete: "set null" }),
    name: text("name").notNull(),
    description: text("description"),
    hypothesis: text("hypothesis"),
    status: text("status").default("draft").notNull().$type<ExperimentStatus>(),
    winningVariant: text("winning_variant"),
    startedAt: timestamp("started_at", { mode: "string" }),
    endedAt: timestamp("ended_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  table => [
    unique("experiments_site_flag_unique").on(table.siteId, table.featureFlagId),
    index("experiments_site_idx").on(table.siteId),
    index("experiments_feature_flag_idx").on(table.featureFlagId),
    index("experiments_primary_goal_idx").on(table.primaryGoalId),
    check("experiments_status_check", sql`status IN ('draft', 'running', 'paused', 'completed')`),
  ]
);

// Telemetry table for tracking self-hosted instances
export const telemetry = pgTable("telemetry", {
  id: serial("id").primaryKey().notNull(),
  instanceId: text("instance_id").notNull(),
  timestamp: timestamp("timestamp", { mode: "string" }).notNull().defaultNow(),
  version: text("version").notNull(),
  tableCounts: jsonb("table_counts").notNull().$type<Record<string, number>>(),
  clickhouseSizeGb: real("clickhouse_size_gb").notNull(),
});

// Uptime monitor definitions
export const uptimeMonitors = pgTable("uptime_monitors", {
  id: serial("id").primaryKey().notNull(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  name: text("name"),
  monitorType: text("monitor_type").notNull(), // 'http', 'tcp'

  // Common settings
  intervalSeconds: integer("interval_seconds").notNull(),
  enabled: boolean("enabled").default(true),

  // HTTP/HTTPS specific configuration
  httpConfig: jsonb("http_config").$type<{
    url: string;
    method: "GET" | "POST" | "PUT" | "DELETE" | "HEAD" | "OPTIONS" | "PATCH";
    headers?: Record<string, string>;
    body?: string;
    auth?: {
      type: "none" | "basic" | "bearer" | "api_key" | "custom_header";
      credentials?: {
        username?: string;
        password?: string;
        token?: string;
        headerName?: string;
        headerValue?: string;
      };
    };
    followRedirects?: boolean;
    timeoutMs?: number;
    ipVersion?: "any" | "ipv4" | "ipv6";
    userAgent?: string;
  }>(),

  // TCP specific configuration
  tcpConfig: jsonb("tcp_config").$type<{
    host: string;
    port: number;
    timeoutMs?: number;
  }>(),

  // Validation rules
  validationRules: jsonb("validation_rules").notNull().default([]).$type<
    Array<
      | {
          type: "status_code";
          operator: "equals" | "not_equals" | "in" | "not_in";
          value: number | number[];
        }
      | {
          type: "response_time";
          operator: "less_than" | "greater_than";
          value: number;
        }
      | {
          type: "response_body_contains" | "response_body_not_contains";
          value: string;
          caseSensitive?: boolean;
        }
      | {
          type: "header_exists";
          header: string;
        }
      | {
          type: "header_value";
          header: string;
          operator: "equals" | "contains";
          value: string;
        }
      | {
          type: "response_size";
          operator: "less_than" | "greater_than";
          value: number;
        }
    >
  >(),

  // Multi-region configuration
  monitoringType: text("monitoring_type").default("local"), // 'local' or 'global'
  selectedRegions: jsonb("selected_regions").default(["local"]).$type<string[]>(),

  // Metadata
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow(),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
});

// Monitor status tracking
export const uptimeMonitorStatus = pgTable(
  "uptime_monitor_status",
  {
    monitorId: integer("monitor_id")
      .primaryKey()
      .notNull()
      .references(() => uptimeMonitors.id, { onDelete: "cascade" }),
    lastCheckedAt: timestamp("last_checked_at", { mode: "string" }),
    nextCheckAt: timestamp("next_check_at", { mode: "string" }),
    currentStatus: text("current_status").default("unknown"), // 'up', 'down', 'unknown'
    consecutiveFailures: integer("consecutive_failures").default(0),
    consecutiveSuccesses: integer("consecutive_successes").default(0),
    uptimePercentage24h: real("uptime_percentage_24h"),
    uptimePercentage7d: real("uptime_percentage_7d"),
    uptimePercentage30d: real("uptime_percentage_30d"),
    averageResponseTime24h: real("average_response_time_24h"),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow(),
  },
  table => [
    foreignKey({
      columns: [table.monitorId],
      foreignColumns: [uptimeMonitors.id],
      name: "uptime_monitor_status_monitor_id_uptime_monitors_id_fk",
    }),
    check("uptime_monitor_status_current_status_check", sql`current_status IN ('up', 'down', 'unknown')`),
    check("uptime_monitor_status_uptime_24h_check", sql`uptime_percentage_24h >= 0 AND uptime_percentage_24h <= 100`),
    check("uptime_monitor_status_uptime_7d_check", sql`uptime_percentage_7d >= 0 AND uptime_percentage_7d <= 100`),
    check("uptime_monitor_status_uptime_30d_check", sql`uptime_percentage_30d >= 0 AND uptime_percentage_30d <= 100`),
    index("uptime_monitor_status_updated_at_idx").on(table.updatedAt),
  ]
);

// Alert configuration (scaffolding)
export const uptimeAlerts = pgTable(
  "uptime_alerts",
  {
    id: serial("id").primaryKey().notNull(),
    monitorId: integer("monitor_id")
      .notNull()
      .references(() => uptimeMonitors.id, { onDelete: "cascade" }),
    alertType: text("alert_type").notNull(), // 'email', 'webhook', 'slack', etc.
    alertConfig: jsonb("alert_config").notNull(), // Type-specific configuration
    conditions: jsonb("conditions").notNull().$type<{
      consecutiveFailures?: number;
      responseTimeThresholdMs?: number;
      uptimePercentageThreshold?: number;
    }>(),
    enabled: boolean("enabled").default(true),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
  },
  table => [
    foreignKey({
      columns: [table.monitorId],
      foreignColumns: [uptimeMonitors.id],
      name: "uptime_alerts_monitor_id_uptime_monitors_id_fk",
    }),
  ]
);

// Alert history (scaffolding)
export const uptimeAlertHistory = pgTable(
  "uptime_alert_history",
  {
    id: serial("id").primaryKey().notNull(),
    alertId: integer("alert_id")
      .notNull()
      .references(() => uptimeAlerts.id, { onDelete: "cascade" }),
    monitorId: integer("monitor_id")
      .notNull()
      .references(() => uptimeMonitors.id, { onDelete: "cascade" }),
    triggeredAt: timestamp("triggered_at", { mode: "string" }).defaultNow(),
    resolvedAt: timestamp("resolved_at", { mode: "string" }),
    alertData: jsonb("alert_data"), // Context about what triggered the alert
  },
  table => [
    foreignKey({
      columns: [table.alertId],
      foreignColumns: [uptimeAlerts.id],
      name: "uptime_alert_history_alert_id_uptime_alerts_id_fk",
    }),
    foreignKey({
      columns: [table.monitorId],
      foreignColumns: [uptimeMonitors.id],
      name: "uptime_alert_history_monitor_id_uptime_monitors_id_fk",
    }),
  ]
);

// Agent regions for VPS-based monitoring
export const agentRegions = pgTable("agent_regions", {
  code: text("code").primaryKey().notNull(), // Region code (e.g., 'us-east', 'europe')
  name: text("name").notNull(), // Region display name
  endpointUrl: text("endpoint_url").notNull(), // Agent endpoint URL
  enabled: boolean("enabled").default(true),
  lastHealthCheck: timestamp("last_health_check", { mode: "string" }),
  isHealthy: boolean("is_healthy").default(true),
});

// Uptime incidents table
export const uptimeIncidents = pgTable("uptime_incidents", {
  id: serial("id").primaryKey().notNull(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  monitorId: integer("monitor_id")
    .notNull()
    .references(() => uptimeMonitors.id, { onDelete: "cascade" }),
  region: text("region"), // Region where incident occurred

  // Incident timing
  startTime: timestamp("start_time", { mode: "string" }).notNull(),
  endTime: timestamp("end_time", { mode: "string" }), // null if ongoing

  // Status
  status: text("status").notNull().default("active"), // 'active', 'acknowledged', 'resolved'

  // Acknowledgement details
  acknowledgedBy: text("acknowledged_by").references(() => user.id, { onDelete: "set null" }),
  acknowledgedAt: timestamp("acknowledged_at", { mode: "string" }),

  // Resolution details
  resolvedBy: text("resolved_by").references(() => user.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { mode: "string" }),

  // Error details
  lastError: text("last_error"),
  lastErrorType: text("last_error_type"),
  failureCount: integer("failure_count").default(1),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow(),
});

// Notification channels table
export const notificationChannels = pgTable("notification_channels", {
  id: serial("id").primaryKey().notNull(),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organization.id),
  type: text("type").notNull(), // 'email', 'discord', 'slack', 'sms'
  name: text("name").notNull(),
  enabled: boolean("enabled").default(true),

  // Channel-specific configuration
  config: jsonb("config").notNull().$type<{
    // Email config
    email?: string;

    // Discord config
    webhookUrl?: string;

    // Slack config
    slackWebhookUrl?: string;
    slackChannel?: string;

    // SMS config (placeholder)
    phoneNumber?: string;
    provider?: string;
  }>(),

  // Monitor selection and notification settings
  monitorIds: jsonb("monitor_ids").$type<number[] | null>(), // null = all monitors
  triggerEvents: jsonb("trigger_events").notNull().default(["down", "recovery"]).$type<string[]>(), // 'down', 'recovery', 'degraded'
  cooldownMinutes: integer("cooldown_minutes").default(5), // Minimum time between notifications
  lastNotifiedAt: timestamp("last_notified_at", { mode: "string" }),

  createdAt: timestamp("created_at", { mode: "string" }).defaultNow(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow(),
  createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
});

// Google Search Console connections table
export const gscConnections = pgTable("gsc_connections", {
  siteId: integer("site_id")
    .primaryKey()
    .notNull()
    .references(() => sites.siteId, { onDelete: "cascade" }),

  // OAuth tokens
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),

  // Which GSC property this connection is for
  gscPropertyUrl: text("gsc_property_url").notNull(),

  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
});

// User profiles - stores identified user traits (email, name, custom fields)
export const userProfiles = pgTable(
  "user_profiles",
  {
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.siteId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(), // The identified user ID from identify() call
    traits: jsonb("traits").$type<Record<string, unknown>>().default({}),
    identitySource: text("identity_source"),
    lastIdentifiedAt: timestamp("last_identified_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  table => [primaryKey({ columns: [table.siteId, table.userId] }), index("user_profiles_site_idx").on(table.siteId)]
);

// User aliases - maps anonymous IDs to identified users (multi-device support)
export const userAliases = pgTable(
  "user_aliases",
  {
    id: serial("id").primaryKey().notNull(),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.siteId, { onDelete: "cascade" }),
    anonymousId: text("anonymous_id").notNull(), // Hash of IP+UserAgent (device fingerprint)
    userId: text("user_id").notNull(), // The identified user ID
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  table => [
    unique("user_aliases_site_anon_unique").on(table.siteId, table.anonymousId),
    index("user_aliases_user_idx").on(table.siteId, table.userId),
    index("user_aliases_anon_idx").on(table.siteId, table.anonymousId),
  ]
);

// Per-site controls for verified user identification. Identity is deliberately
// disabled unless an owner/admin enables it after the site's privacy review.
export const siteIdentitySettings = pgTable(
  "site_identity_settings",
  {
    siteId: integer("site_id")
      .primaryKey()
      .notNull()
      .references(() => sites.siteId, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    mode: text("mode").notNull().default("signed"),
    allowedTraits: jsonb("allowed_traits").$type<string[]>().notNull().default(["name", "email", "company", "plan"]),
    retentionDays: integer("retention_days").notNull().default(395),
    activeKeyId: text("active_key_id"),
    lastSuccessAt: timestamp("last_success_at", { mode: "string" }),
    lastFailureAt: timestamp("last_failure_at", { mode: "string" }),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  table => [
    check("site_identity_settings_mode_check", sql`${table.mode} IN ('signed', 'direct')`),
    check("site_identity_settings_retention_check", sql`${table.retentionDays} BETWEEN 1 AND 3650`),
  ]
);

// Secrets are encrypted with IDENTITY_KEY_ENCRYPTION_SECRET before storage.
// Multiple versions allow rotation without invalidating an in-flight assertion.
export const siteIdentityKeys = pgTable(
  "site_identity_keys",
  {
    id: text("id").primaryKey().notNull(),
    siteId: integer("site_id")
      .notNull()
      .references(() => sites.siteId, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    encryptedSecret: text("encrypted_secret").notNull(),
    initializationVector: text("initialization_vector").notNull(),
    authTag: text("auth_tag").notNull(),
    status: text("status").notNull().default("pending"),
    deploymentProvider: text("deployment_provider"),
    deploymentProject: text("deployment_project"),
    deploymentId: text("deployment_id"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    deployedAt: timestamp("deployed_at", { mode: "string" }),
    retiredAt: timestamp("retired_at", { mode: "string" }),
    revokedAt: timestamp("revoked_at", { mode: "string" }),
    lastUsedAt: timestamp("last_used_at", { mode: "string" }),
  },
  table => [
    unique("site_identity_keys_site_version_unique").on(table.siteId, table.version),
    index("site_identity_keys_site_status_idx").on(table.siteId, table.status),
    check("site_identity_keys_status_check", sql`${table.status} IN ('pending', 'active', 'retired', 'revoked')`),
    check("site_identity_keys_version_check", sql`${table.version} > 0`),
  ]
);

// Cancellation feedback for churn reduction
export const cancellationFeedback = pgTable("cancellation_feedback", {
  id: serial("id").primaryKey().notNull(),
  organizationId: text("organization_id").notNull(),
  userId: text("user_id").notNull(),
  reason: text("reason").notNull(),
  reasonDetails: text("reason_details"),
  retentionOfferShown: text("retention_offer_shown"),
  retentionOfferAccepted: boolean("retention_offer_accepted").default(false),
  outcome: text("outcome").notNull(),
  planNameAtCancellation: text("plan_name_at_cancellation"),
  monthlyEventCountAtCancellation: integer("monthly_event_count_at_cancellation"),
  createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
});

export const importPlatforms = ["umami", "simple_analytics", "plausible"] as const;

export const importPlatformEnum = pgEnum("import_platform_enum", importPlatforms);

export const importStatus = pgTable(
  "import_status",
  {
    importId: uuid("import_id").primaryKey().notNull().defaultRandom(),
    siteId: integer("site_id").notNull(),
    organizationId: text("organization_id").notNull(),
    platform: importPlatformEnum("platform").notNull(),
    importedEvents: integer("imported_events").notNull().default(0),
    skippedEvents: integer("skipped_events").notNull().default(0),
    invalidEvents: integer("invalid_events").notNull().default(0),
    startedAt: timestamp("started_at", { mode: "string" }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { mode: "string" }),
  },
  table => [
    foreignKey({
      columns: [table.siteId],
      foreignColumns: [sites.siteId],
      name: "import_status_site_id_sites_site_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId],
      foreignColumns: [organization.id],
      name: "import_status_organization_id_organization_id_fk",
    }),
  ]
);
