import type { IdentificationConsentState, ScriptConfig } from "./types.js";

type StoredConsent = IdentificationConsentState & {
  policyVersion: string;
  withdrawalToken?: string;
  revocationPending?: boolean;
};

export class IdentityConsentManager {
  private readonly storageKey: string;
  private banner?: HTMLElement;

  constructor(private readonly config: ScriptConfig) {
    let analyticsOrigin = "invalid-origin";
    try {
      analyticsOrigin = new URL(config.analyticsHost).origin;
    } catch {
      // Invalid analytics hosts fail closed in grant() and loadConnector().
    }
    this.storageKey = `${config.namespace}-identity-consent:${encodeURIComponent(analyticsOrigin)}:${config.siteId}`;
  }

  private gpcEnabled() {
    return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  }

  private read(): StoredConsent | null {
    try {
      const value = JSON.parse(localStorage.getItem(this.storageKey) || "null") as StoredConsent | null;
      return value?.policyVersion === (this.config.identityPolicyVersion || "identity-v1") ? value : null;
    } catch {
      return null;
    }
  }

  private write(status: IdentificationConsentState["status"], withdrawalToken?: string, revocationPending = false) {
    const state: StoredConsent = {
      status,
      gpc: this.gpcEnabled(),
      policyVersion: this.config.identityPolicyVersion || "identity-v1",
      withdrawalToken,
      revocationPending,
    };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch {
      // Consent still applies for the current request when storage is unavailable.
    }
    return state;
  }

  private async send(granted: boolean, gpc = this.gpcEnabled()) {
    const response = await fetch(`${this.config.analyticsHost}/identity/consent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(gpc ? { "Sec-GPC": "1" } : {}) },
      body: JSON.stringify({
        site_id: this.config.siteId,
        granted: granted && !gpc,
        gpc,
        categories: granted && !gpc ? ["identification"] : [],
      }),
      credentials: "omit",
      mode: "cors",
    });
    if (!response.ok)
      return {
        ok: false,
        granted: false,
        correlationToken: undefined as string | undefined,
        withdrawalToken: undefined as string | undefined,
      };
    const result = (await response.json?.().catch(() => ({}))) as
      | { success?: boolean; granted?: boolean; correlationToken?: string; withdrawalToken?: string }
      | undefined;
    return {
      ok: result?.success === true,
      granted: result?.granted === true,
      correlationToken: result?.correlationToken,
      withdrawalToken: result?.withdrawalToken,
    };
  }

  private loadConnector(correlationToken?: string) {
    if (!this.config.identityResolutionEnabled || !correlationToken || !this.config.identityConnectorUrl) return;
    try {
      if (new URL(this.config.identityConnectorUrl).origin !== new URL(this.config.analyticsHost).origin) return;
    } catch {
      return;
    }
    if (document.querySelector(`script[data-rybbit-identity-connector="${this.config.siteId}"]`)) return;
    const script = document.createElement("script");
    script.src = this.config.identityConnectorUrl;
    script.async = true;
    script.dataset.rybbitIdentityConnector = this.config.siteId;
    script.dataset.siteId = this.config.siteId;
    script.dataset.correlationToken = correlationToken;
    document.head.appendChild(script);
  }

  async initialize() {
    const stored = this.read();
    if (stored?.revocationPending && stored.withdrawalToken) {
      await this.withdraw();
      return;
    }
    if (!this.config.identityResolutionEnabled) return;
    if (this.gpcEnabled()) {
      this.write("denied");
      await this.send(false, true).catch(() => ({ ok: false }));
      return;
    }
    if (stored) return;
    if (!document.body) {
      await new Promise<void>(resolve => {
        document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
      });
    }
    if (!document.body || this.read()) return;
    this.renderBanner();
  }

  getState(): IdentificationConsentState {
    const stored = this.read();
    return stored ?? { status: "unknown", gpc: this.gpcEnabled() };
  }

  async grant() {
    if (!this.config.identityResolutionEnabled || this.gpcEnabled()) return false;
    const result = await this.send(true, false).catch(() => ({
      ok: false,
      granted: false,
      correlationToken: undefined,
      withdrawalToken: undefined,
    }));
    if (result.ok && result.granted && result.withdrawalToken) {
      this.write("granted", result.withdrawalToken);
      this.removeBanner();
      this.loadConnector(result.correlationToken);
      return true;
    }
    return false;
  }

  async reject() {
    const result = await this.send(false).catch(() => ({ ok: false }));
    this.write("denied");
    this.removeBanner();
    return result.ok;
  }

  async withdraw() {
    const stored = this.read();
    if (!stored?.withdrawalToken) {
      this.write("denied");
      this.removeBanner();
      return false;
    }
    this.write("denied", stored.withdrawalToken, true);
    this.removeBanner();
    document.querySelector(`script[data-rybbit-identity-connector="${this.config.siteId}"]`)?.remove();
    const response = await fetch(`${this.config.analyticsHost}/identity/withdraw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site_id: this.config.siteId, withdrawal_token: stored?.withdrawalToken }),
      credentials: "omit",
      mode: "cors",
    }).catch(() => null);
    const result = response?.ok
      ? ((await response.json?.().catch(() => null)) as { success?: boolean; suppressed?: boolean } | null)
      : null;
    const withdrawn = result?.success === true && result.suppressed === true;
    if (withdrawn) {
      this.write("denied");
    }
    return withdrawn;
  }

  private removeBanner() {
    this.banner?.remove();
    this.banner = undefined;
  }

  private renderBanner() {
    const root = document.createElement("section");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Optional visitor identification");
    root.style.cssText =
      "position:fixed;z-index:2147483647;left:16px;right:16px;bottom:16px;max-width:620px;margin:auto;padding:16px;border:1px solid #d4d4d4;border-radius:12px;background:#fff;color:#171717;box-shadow:0 12px 36px rgba(0,0,0,.18);font:14px/1.45 system-ui,sans-serif";
    const text = document.createElement("p");
    text.style.cssText = "margin:0 0 12px";
    text.textContent =
      "May we use optional identity matching to understand who visits this website? Regular privacy-friendly analytics works either way.";
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
    const accept = document.createElement("button");
    accept.type = "button";
    accept.textContent = "Allow identity matching";
    accept.style.cssText =
      "border:0;border-radius:8px;background:#0f766e;color:#fff;padding:9px 12px;font:600 14px system-ui;cursor:pointer";
    accept.addEventListener("click", () => void this.grant());
    const decline = document.createElement("button");
    decline.type = "button";
    decline.textContent = "Continue anonymously";
    decline.style.cssText =
      "border:1px solid #a3a3a3;border-radius:8px;background:#fff;color:#171717;padding:9px 12px;font:600 14px system-ui;cursor:pointer";
    decline.addEventListener("click", () => void this.reject());
    actions.append(accept, decline);
    root.append(text, actions);
    document.body.appendChild(root);
    this.banner = root;
  }
}
