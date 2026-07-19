import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/postgres/postgres.js", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const schema = await import("../../db/postgres/schema.js");
  const client = new PGlite();
  return { db: drizzle(client, { schema }), sql: client };
});

vi.mock("../../lib/auth-utils.js", () => ({
  getUserIdFromRequest: vi.fn(async (request: any) => request.user?.id ?? null),
  getSitesUserHasAccessTo: vi.fn(async (request: any) => {
    if (request.user?.id === "viewer") return [{ siteId: 1, organizationId: "org_1" }];
    return [];
  }),
}));

import { sql } from "../../db/postgres/postgres.js";
import { getAgencyClient, listAgencyClients } from "./clients.js";

const DDL = `
CREATE TABLE "member" ("id" text PRIMARY KEY, "organizationId" text NOT NULL, "userId" text NOT NULL, "role" text NOT NULL, "createdAt" timestamp DEFAULT now(), "has_restricted_site_access" boolean DEFAULT false NOT NULL);
CREATE TABLE "sites" ("site_id" serial PRIMARY KEY, "id" text, "name" text NOT NULL, "domain" text NOT NULL, "organization_id" text);
CREATE TABLE "agency_clients" ("id" text PRIMARY KEY, "organization_id" text NOT NULL, "team_id" text NOT NULL, "name" text NOT NULL, "slug" text NOT NULL, "status" text NOT NULL, "logo_url" text, "timezone" text NOT NULL, "external_ref" text, "created_at" timestamp NOT NULL, "updated_at" timestamp NOT NULL);
CREATE TABLE "agency_client_sites" ("id" serial PRIMARY KEY, "client_id" text NOT NULL, "site_id" integer NOT NULL, "is_primary" boolean NOT NULL, "tracking_method" text NOT NULL, "tracking_status" text NOT NULL, "verified_at" timestamp, "last_checked_at" timestamp);
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

function requestStub(userId: string, clientId?: string) {
  return {
    user: { id: userId },
    params: { organizationId: "org_1", ...(clientId ? { clientId } : {}) },
    log: { error: vi.fn(), warn: vi.fn() },
  } as any;
}

beforeAll(async () => {
  await (sql as any).exec(DDL);
});

beforeEach(async () => {
  await (sql as any).exec(`
    TRUNCATE "member", "sites", "agency_clients", "agency_client_sites" RESTART IDENTITY;
    INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt", "has_restricted_site_access") VALUES
      ('m_owner', 'org_1', 'owner', 'owner', now(), false),
      ('m_viewer', 'org_1', 'viewer', 'member', now(), true),
      ('m_outsider', 'org_2', 'outsider', 'owner', now(), false);
    INSERT INTO "sites" ("site_id", "name", "domain", "organization_id") VALUES
      (1, 'Allowed Site', 'allowed.example', 'org_1'),
      (2, 'Private Site', 'private.example', 'org_1');
    INSERT INTO "agency_clients" ("id", "organization_id", "team_id", "name", "slug", "status", "timezone", "created_at", "updated_at") VALUES
      ('client_allowed', 'org_1', 'team_1', 'Allowed Client', 'allowed-client', 'active', 'UTC', now(), now()),
      ('client_private', 'org_1', 'team_2', 'Private Client', 'private-client', 'active', 'UTC', now(), now()),
      ('client_empty', 'org_1', 'team_3', 'Empty Client', 'empty-client', 'onboarding', 'UTC', now(), now());
    INSERT INTO "agency_client_sites" ("client_id", "site_id", "is_primary", "tracking_method", "tracking_status") VALUES
      ('client_allowed', 1, true, 'script', 'verified'),
      ('client_private', 2, true, 'script', 'verified');
  `);
});

describe("agency client tenant isolation", () => {
  it("allows an owner to list every client, including clients without sites", async () => {
    const reply = replyStub();
    await listAgencyClients(requestStub("owner"), reply);
    expect(reply.statusCode).toBe(200);
    expect(reply.body.clients.map((client: any) => client.id)).toEqual([
      "client_allowed",
      "client_empty",
      "client_private",
    ]);
  });

  it("limits a restricted viewer to clients containing server-authorized sites", async () => {
    const reply = replyStub();
    await listAgencyClients(requestStub("viewer"), reply);
    expect(reply.body.clients.map((client: any) => client.id)).toEqual(["client_allowed"]);
  });

  it("returns not found for direct access to another client", async () => {
    const reply = replyStub();
    await getAgencyClient(requestStub("viewer", "client_private"), reply);
    expect(reply.statusCode).toBe(404);
    expect(reply.body).toEqual({ error: "Client not found" });
  });

  it("rejects a user who is not a member of the organization", async () => {
    const reply = replyStub();
    await getAgencyClient(requestStub("outsider", "client_allowed"), reply);
    expect(reply.statusCode).toBe(404);
  });
});
