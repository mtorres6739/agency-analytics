import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/postgres/postgres.js", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("../../db/postgres/schema.js");
  const client = new PGlite();
  return { db: drizzle(client, { schema }), sql: client };
});

const { queueDeployment } = vi.hoisted(() => ({ queueDeployment: vi.fn(async () => undefined) }));
vi.mock("../../services/trackingDeployment/trackingDeploymentService.js", () => ({
  trackingDeploymentService: { queueDeployment },
}));

vi.mock("../../lib/auth-utils.js", () => ({
  getUserIdFromRequest: vi.fn(async (request: any) => request.user?.id ?? null),
  getSitesUserHasAccessTo: vi.fn(async () => []),
}));

import { sql } from "../../db/postgres/postgres.js";
import {
  applyTrackingDeployment,
  getLatestSiteTrackingDeployment,
  listTrackingDeployments,
  planTrackingDeployment,
} from "./trackingDeployments.js";

const DDL = `
CREATE TABLE "member" ("id" text PRIMARY KEY, "organizationId" text NOT NULL, "userId" text NOT NULL, "role" text NOT NULL, "createdAt" timestamp DEFAULT now(), "has_restricted_site_access" boolean DEFAULT false NOT NULL);
CREATE TABLE "agency_clients" ("id" text PRIMARY KEY, "organization_id" text NOT NULL, "team_id" text NOT NULL, "name" text NOT NULL, "slug" text NOT NULL, "status" text NOT NULL, "logo_url" text, "timezone" text NOT NULL, "external_ref" text, "created_at" timestamp NOT NULL, "updated_at" timestamp NOT NULL);
CREATE TABLE "agency_client_sites" ("id" serial PRIMARY KEY, "client_id" text NOT NULL, "site_id" integer NOT NULL, "is_primary" boolean NOT NULL, "tracking_method" text NOT NULL, "tracking_status" text NOT NULL, "verified_at" timestamp, "last_checked_at" timestamp);
CREATE TABLE "tracking_deployments" ("id" text PRIMARY KEY, "organization_id" text NOT NULL, "client_id" text NOT NULL, "site_id" integer NOT NULL, "provider" text NOT NULL, "action" text NOT NULL, "status" text NOT NULL, "input" jsonb NOT NULL DEFAULT '{}', "result" jsonb NOT NULL DEFAULT '{}', "error_summary" text, "actor_user_id" text, "created_at" timestamp NOT NULL, "updated_at" timestamp NOT NULL, "started_at" timestamp, "completed_at" timestamp);
CREATE TABLE "agency_audit_events" ("id" serial PRIMARY KEY, "organization_id" text NOT NULL, "client_id" text, "actor_user_id" text, "action" text NOT NULL, "target_type" text NOT NULL, "target_id" text, "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" timestamp DEFAULT now() NOT NULL);
`;

function replyStub() {
  const reply: any = { statusCode: 200 };
  reply.status = (code: number) => {
    reply.statusCode = code;
    return reply;
  };
  reply.send = (body?: unknown) => {
    reply.body = body;
    return reply;
  };
  return reply;
}

function requestStub(userId: string, clientId = "client_1", siteId = "1", body: unknown = {}) {
  return {
    user: { id: userId },
    params: { organizationId: "org_1", clientId, siteId },
    body,
    log: { error: vi.fn(), warn: vi.fn() },
  } as any;
}

beforeAll(async () => {
  await (sql as any).exec(DDL);
});

beforeEach(async () => {
  queueDeployment.mockClear();
  await (sql as any).exec(`
    TRUNCATE "member", "agency_clients", "agency_client_sites", "tracking_deployments", "agency_audit_events" RESTART IDENTITY;
    INSERT INTO "member" ("id", "organizationId", "userId", "role") VALUES
      ('owner_1', 'org_1', 'owner', 'owner'),
      ('viewer_1', 'org_1', 'viewer', 'member');
    INSERT INTO "agency_clients" ("id", "organization_id", "team_id", "name", "slug", "status", "timezone", "created_at", "updated_at") VALUES
      ('client_1', 'org_1', 'team_1', 'Client One', 'client-one', 'active', 'UTC', now(), now()),
      ('client_2', 'org_1', 'team_2', 'Client Two', 'client-two', 'active', 'UTC', now(), now());
    INSERT INTO "agency_client_sites" ("client_id", "site_id", "is_primary", "tracking_method", "tracking_status") VALUES
      ('client_1', 1, true, 'script', 'pending'),
      ('client_2', 2, true, 'script', 'pending');
  `);
});

describe("tracking deployment access and queueing", () => {
  it("queues a sanitized auto-detection plan for an owner", async () => {
    const reply = replyStub();
    await planTrackingDeployment(requestStub("owner", "client_1", "1", { preferredProvider: "auto" }), reply);
    expect(reply.statusCode).toBe(202);
    expect(reply.body.deployment).toMatchObject({ siteId: 1, provider: "manual", action: "plan", status: "queued" });
    expect(queueDeployment).toHaveBeenCalledWith(reply.body.deployment.id);
  });

  it("does not expose deployment state to a non-managing client viewer", async () => {
    const reply = replyStub();
    await listTrackingDeployments(requestStub("viewer"), reply);
    expect(reply.statusCode).toBe(404);
  });

  it("rejects using a plan from another client or site", async () => {
    await (sql as any).exec(`
      INSERT INTO "tracking_deployments" ("id", "organization_id", "client_id", "site_id", "provider", "action", "status", "created_at", "updated_at")
      VALUES ('foreign_plan', 'org_1', 'client_2', 2, 'vercel', 'plan', 'succeeded', now(), now());
    `);
    const request = requestStub("owner") as any;
    request.params.deploymentId = "foreign_plan";
    const reply = replyStub();
    await applyTrackingDeployment(request, reply);
    expect(reply.statusCode).toBe(409);
    expect(queueDeployment).not.toHaveBeenCalled();
  });

  it("validates provider input before creating a job", async () => {
    const reply = replyStub();
    await planTrackingDeployment(requestStub("owner", "client_1", "1", { preferredProvider: "ftp" }), reply);
    expect(reply.statusCode).toBe(400);
    expect(queueDeployment).not.toHaveBeenCalled();
  });

  it("returns the latest site deployment to an organization owner", async () => {
    await (sql as any).exec(`
      INSERT INTO "tracking_deployments" ("id", "organization_id", "client_id", "site_id", "provider", "action", "status", "created_at", "updated_at")
      VALUES ('latest', 'org_1', 'client_1', 1, 'vercel', 'plan', 'running', now(), now());
    `);
    const reply = replyStub();
    await getLatestSiteTrackingDeployment(requestStub("owner", "client_1", "1"), reply);
    expect(reply.body.deployment).toMatchObject({ id: "latest", clientId: "client_1", siteId: 1, status: "running" });
  });

  it("does not expose site deployment state to an unrelated restricted member", async () => {
    const reply = replyStub();
    await getLatestSiteTrackingDeployment(requestStub("viewer", "client_1", "1"), reply);
    expect(reply.statusCode).toBe(404);
  });
});
