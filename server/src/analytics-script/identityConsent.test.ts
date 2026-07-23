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

  it("stores the withdrawal token after a successful grant", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ withdrawalToken: "withdraw_1" }),
    } as any);
    const manager = new IdentityConsentManager(config);
    await manager.initialize();
    await expect(manager.grant()).resolves.toBe(true);
    expect(JSON.parse(localStorage.getItem("rybbit-identity-consent") || "{}")).toMatchObject({
      status: "granted",
      withdrawalToken: "withdraw_1",
    });
  });

  it("records a rejected choice", async () => {
    const manager = new IdentityConsentManager(config);
    await manager.initialize();
    await expect(manager.reject()).resolves.toBe(true);
    expect(manager.getState()).toMatchObject({ status: "denied", gpc: false });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("keeps granted state and the withdrawal token until withdrawal succeeds", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ withdrawalToken: "withdraw_retry" }),
      } as any)
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ ok: true } as any);
    const manager = new IdentityConsentManager(config);
    await manager.initialize();
    await manager.grant();

    await expect(manager.withdraw()).resolves.toBe(false);
    expect(JSON.parse(localStorage.getItem("rybbit-identity-consent") || "{}")).toMatchObject({
      status: "granted",
      withdrawalToken: "withdraw_retry",
    });

    await expect(manager.withdraw()).resolves.toBe(true);
    expect(manager.getState()).toMatchObject({ status: "denied", gpc: false });
    expect(JSON.parse(localStorage.getItem("rybbit-identity-consent") || "{}")).not.toHaveProperty("withdrawalToken");
    expect(vi.mocked(fetch).mock.calls[1]?.[1]?.body).toContain("withdraw_retry");
    expect(vi.mocked(fetch).mock.calls[2]?.[1]?.body).toContain("withdraw_retry");
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
