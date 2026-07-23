import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityConsentManager } from "./identityConsent.js";
import type { ScriptConfig } from "./types.js";

const config = {
  namespace: "rybbit",
  analyticsHost: "https://analytics.example.com/api",
  siteId: "site_public",
  visitorId: "visitor_public",
  debounceDuration: 500,
  autoTrackPageview: true,
  autoTrackSpa: true,
  trackQuerystring: true,
  trackOutbound: true,
  enableWebVitals: false,
  trackErrors: false,
  enableSessionReplay: false,
  sessionReplayBatchSize: 250,
  sessionReplayBatchInterval: 5_000,
  sessionReplayMaskTextSelectors: [],
  skipPatterns: [],
  maskPatterns: [],
  trackButtonClicks: false,
  trackCopy: false,
  trackFormInteractions: false,
  tag: "",
  featureFlags: {},
  identityResolutionEnabled: true,
  identityPolicyVersion: "identity-v1",
  identityConnectorUrl: "https://analytics.example.com/identity/connector.js",
} satisfies ScriptConfig;

const storageKey = "rybbit-identity-consent:https%3A%2F%2Fanalytics.example.com:site_public";
const consentResponse = (input: { granted: boolean; withdrawalToken?: string; correlationToken?: string }): Response =>
  ({
    ok: true,
    json: vi.fn().mockResolvedValue({ success: true, ...input }),
  }) as unknown as Response;
const withdrawalResponse = (): Response =>
  ({
    ok: true,
    json: vi.fn().mockResolvedValue({ success: true, suppressed: true }),
  }) as unknown as Response;

describe("identity consent manager", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        consentResponse({
          granted: true,
          withdrawalToken: "withdraw_default",
          correlationToken: "correlation_default",
        })
      )
    );
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: false });
  });

  it("does not call a provider before affirmative consent", async () => {
    const manager = new IdentityConsentManager(config);
    await manager.initialize();
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await manager.grant();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(manager.getState().status).toBe("granted");
  });

  it("stores the withdrawal token after a successful grant", async () => {
    vi.mocked(fetch).mockResolvedValue(
      consentResponse({ granted: true, withdrawalToken: "withdraw_1", correlationToken: "correlation_1" })
    );
    const manager = new IdentityConsentManager(config);
    await manager.initialize();
    await expect(manager.grant()).resolves.toBe(true);
    expect(JSON.parse(localStorage.getItem(storageKey) || "{}")).toMatchObject({
      status: "granted",
      withdrawalToken: "withdraw_1",
    });
  });

  it("records a rejected choice", async () => {
    vi.mocked(fetch).mockResolvedValue(consentResponse({ granted: false }));
    const manager = new IdentityConsentManager(config);
    await manager.initialize();
    await expect(manager.reject()).resolves.toBe(true);
    expect(manager.getState()).toMatchObject({ status: "denied", gpc: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("denies locally while retaining a durable withdrawal retry token", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        consentResponse({
          granted: true,
          withdrawalToken: "withdraw_retry",
          correlationToken: "correlation_retry",
        })
      )
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(withdrawalResponse());
    const manager = new IdentityConsentManager(config);
    await manager.initialize();
    await manager.grant();

    await expect(manager.withdraw()).resolves.toBe(false);
    expect(JSON.parse(localStorage.getItem(storageKey) || "{}")).toMatchObject({
      status: "denied",
      withdrawalToken: "withdraw_retry",
      revocationPending: true,
    });

    await expect(manager.withdraw()).resolves.toBe(true);
    expect(manager.getState()).toMatchObject({ status: "denied", gpc: false });
    expect(JSON.parse(localStorage.getItem(storageKey) || "{}")).not.toHaveProperty("withdrawalToken");
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.body).toContain("withdraw_retry");
    expect(vi.mocked(fetch).mock.calls[2]?.[1]?.body).toContain("withdraw_retry");
  });

  it("rejects malformed grant responses without persisting consent", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true, granted: true }),
    } as unknown as Response);
    const manager = new IdentityConsentManager(config);
    await manager.initialize();

    await expect(manager.grant()).resolves.toBe(false);
    expect(manager.getState().status).toBe("unknown");
  });

  it("fails closed when resolution is disabled", async () => {
    const manager = new IdentityConsentManager({ ...config, identityResolutionEnabled: false });

    await expect(manager.grant()).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not load a cross-origin connector", async () => {
    const manager = new IdentityConsentManager({
      ...config,
      identityConnectorUrl: "https://provider.example.net/connector.js",
    });
    await manager.initialize();
    await expect(manager.grant()).resolves.toBe(true);

    expect(document.querySelector("[data-rybbit-identity-connector]")).toBeNull();
  });

  it("scopes consent storage by analytics origin and site", async () => {
    const first = new IdentityConsentManager(config);
    const second = new IdentityConsentManager({ ...config, siteId: "another_site" });
    await first.grant();
    await second.grant();

    expect(localStorage.length).toBe(2);
    expect(localStorage.getItem(storageKey)).not.toBeNull();
    expect(
      localStorage.getItem("rybbit-identity-consent:https%3A%2F%2Fanalytics.example.com:another_site")
    ).not.toBeNull();
  });

  it("waits for document.body before rendering the consent banner", async () => {
    document.body.remove();
    const manager = new IdentityConsentManager(config);
    const initializing = manager.initialize();
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    document.documentElement.appendChild(document.createElement("body"));
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await initializing;

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("honors GPC and records a denial", async () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: true });
    const manager = new IdentityConsentManager(config);
    await manager.initialize();
    expect(manager.getState()).toMatchObject({ status: "denied", gpc: true });
    expect(fetch).toHaveBeenCalledWith(
      "https://analytics.example.com/api/identity/consent",
      expect.objectContaining({ headers: expect.objectContaining({ "Sec-GPC": "1" }) })
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
});
