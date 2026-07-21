import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdentityConsentManager } from "./identityConsent.js";
import type { ScriptConfig } from "./types.js";

const config = {
  namespace: "rybbit",
  analyticsHost: "https://analytics.example.com/api",
  siteId: "site_public",
  identityResolutionEnabled: true,
  identityPolicyVersion: "identity-v1",
} as ScriptConfig;

describe("identity consent manager", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
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
