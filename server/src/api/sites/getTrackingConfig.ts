import { FastifyReply, FastifyRequest } from "fastify";
import { siteConfig } from "../../lib/siteConfig.js";
import { usageService } from "../../services/usageService.js";
import { getPilotBudgetCents, getProviderCostMicros } from "../../services/identityResolution/pricing.js";

const configuredConnectorUrl = process.env.IDENTITY_CONNECTOR_URL?.trim();
let connectorUrl: string | null = null;
if (configuredConnectorUrl && process.env.BASE_URL) {
  try {
    if (new URL(configuredConnectorUrl).origin === new URL(process.env.BASE_URL).origin) {
      connectorUrl = configuredConnectorUrl;
    }
  } catch {
    connectorUrl = null;
  }
}

export async function getTrackingConfig(request: FastifyRequest<{ Params: { siteId: string } }>, reply: FastifyReply) {
  try {
    const config = await siteConfig.getConfig(request.params.siteId);

    // Return 404 if site doesn't exist
    if (!config) {
      return reply.status(404).send({ error: "Site not found" });
    }

    // Report replay as off when the plan doesn't include it so the tracking script
    // never loads the recorder (replay payloads would be dropped at ingest anyway)
    const sessionReplay =
      config.type === "mobile"
        ? false
        : (config.sessionReplay && !usageService.isSiteWithoutReplay(config.siteId)) || false;
    // Return tracking configuration
    // This endpoint is public since the analytics script needs to fetch it
    const resolution = config.identityResolution ?? {
      enabled: false,
      complianceState: "pending",
      policyVersion: "identity-v1",
      primaryProvider: "customers_ai",
      transport: "server",
    };
    const resolutionPricingConfigured =
      getPilotBudgetCents() !== null &&
      getProviderCostMicros(resolution.primaryProvider as "customers_ai" | "rb2b") !== null;
    return reply.send({
      type: config.type,
      sessionReplay,
      webVitals: config.type === "mobile" ? false : config.webVitals || false,
      trackErrors: config.trackErrors || false,
      trackOutbound: config.trackOutbound ?? true,
      trackUrlParams: config.trackUrlParams ?? true,
      trackInitialPageView: config.trackInitialPageView ?? true,
      trackSpaNavigation: config.trackSpaNavigation ?? true,
      trackButtonClicks: config.trackButtonClicks || false,
      trackCopy: config.trackCopy || false,
      trackFormInteractions: config.trackFormInteractions || false,
      identityResolution: {
        enabled: resolution.enabled && resolution.complianceState === "approved" && resolutionPricingConfigured,
        policyVersion: resolution.policyVersion,
        connectorUrl: resolution.transport === "pixel" ? connectorUrl : null,
      },
    });
  } catch (error) {
    console.error("Error getting tracking config:", error);
    return reply.status(500).send({ error: "Failed to get tracking configuration" });
  }
}
