import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RybbitApiClient } from "../apiClient.js";
import { siteIdInput } from "../inputs.js";
import {
  destructiveTool,
  looseRows,
  ok,
  readOnly,
  writeTool,
  type ScopeCheck,
  type ToolGuard,
} from "./shared.js";

const candidateId = z.string().uuid().describe("Identity candidate id from get_identity_candidates");

export function registerIdentityTools(server: McpServer, api: RybbitApiClient, guard: ToolGuard, allowed: ScopeCheck) {
  if (allowed("identity", "read")) {
    server.registerTool(
      "get_identity_candidates",
      {
        title: "List identity candidates",
        description: "List consented deterministic and possible identity matches with confidence and field provenance.",
        inputSchema: {
          site_id: siteIdInput,
          status: z.enum(["pending", "approved", "rejected", "suppressed", "expired"]).optional(),
          provider: z.enum(["customers_ai", "rb2b"]).optional(),
          min_confidence: z.number().min(0).max(1).optional(),
        },
        outputSchema: z.object({ data: looseRows.optional(), totalCount: z.number().optional() }).passthrough(),
        annotations: readOnly,
      },
      guard(async ({ site_id, status, provider, min_confidence }) =>
        ok(
          await api.call("GET", `/sites/${site_id}/identity-candidates`, {
            query: { status, provider, minConfidence: min_confidence },
          })
        )
      )
    );
    server.registerTool(
      "get_identity_provider_usage",
      {
        title: "Identity provider usage",
        description: "Read provider requests, matches, failures, latency, estimated cost, and budget status for a site.",
        inputSchema: { site_id: siteIdInput },
        outputSchema: z.object({ data: looseRows.optional(), totals: z.record(z.unknown()).optional() }).passthrough(),
        annotations: readOnly,
      },
      guard(async ({ site_id }) => ok(await api.call("GET", `/sites/${site_id}/provider-usage`)))
    );
  }

  if (allowed("identity", "write")) {
    server.registerTool(
      "generate_identity_lead_brief",
      {
        title: "Generate lead brief",
        description:
          "Generate a bounded analyst brief from allowed normalized business fields. The model does not decide identity confidence.",
        inputSchema: { site_id: siteIdInput, candidate_id: candidateId },
        outputSchema: z.object({ score: z.number(), reasons: z.array(z.string()), brief: z.string() }).passthrough(),
        annotations: writeTool,
      },
      guard(async ({ site_id, candidate_id }) =>
        ok(await api.call("POST", `/sites/${site_id}/identity-candidates/${candidate_id}/brief`))
      )
    );
    server.registerTool(
      "approve_identity_candidate",
      {
        title: "Approve identity candidate",
        description:
          "Confirm and link a reviewed candidate. CRM routing is separate and remains off unless send_to_ghl is explicitly true.",
        inputSchema: { site_id: siteIdInput, candidate_id: candidateId, send_to_ghl: z.boolean().default(false) },
        outputSchema: z.object({ success: z.boolean() }).passthrough(),
        annotations: writeTool,
      },
      guard(async ({ site_id, candidate_id, send_to_ghl }) =>
        ok(
          await api.call("POST", `/sites/${site_id}/identity-candidates/${candidate_id}/approve`, {
            body: { sendToCrm: send_to_ghl },
          })
        )
      )
    );
    server.registerTool(
      "reject_identity_candidate",
      {
        title: "Reject identity candidate",
        description: "Reject a possible match without linking it to the visitor profile.",
        inputSchema: { site_id: siteIdInput, candidate_id: candidateId },
        outputSchema: z.object({ success: z.boolean() }).passthrough(),
        annotations: writeTool,
      },
      guard(async ({ site_id, candidate_id }) =>
        ok(await api.call("POST", `/sites/${site_id}/identity-candidates/${candidate_id}/reject`, { body: {} }))
      )
    );
    server.registerTool(
      "suppress_identity_candidate",
      {
        title: "Suppress identity candidate",
        description: "Suppress a candidate. This is a privacy-impacting write and should be confirmed before calling.",
        inputSchema: { site_id: siteIdInput, candidate_id: candidateId },
        outputSchema: z.object({ success: z.boolean() }).passthrough(),
        annotations: destructiveTool,
      },
      guard(async ({ site_id, candidate_id }) =>
        ok(await api.call("POST", `/sites/${site_id}/identity-candidates/${candidate_id}/suppress`, { body: {} }))
      )
    );
  }
}
