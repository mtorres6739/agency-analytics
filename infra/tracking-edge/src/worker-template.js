const SITE_MAP = __SITE_MAP_JSON__;
const ANALYTICS_ORIGIN = __ANALYTICS_ORIGIN_JSON__;
const PATH_PREFIX = __PATH_PREFIX_JSON__;

const EXCLUDED_PATHS = [
  "/wp-admin",
  "/wp-login.php",
  "/wp-json",
  "/xmlrpc.php",
  "/api",
  "/_next",
  "/cdn-cgi",
];

function isExcludedPath(pathname) {
  return EXCLUDED_PATHS.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isHtmlResponse(response) {
  return response.headers.get("content-type")?.toLowerCase().includes("text/html") ?? false;
}

function needsNonce(response) {
  const policy = response.headers.get("content-security-policy") ?? "";
  return /(?:'nonce-[^']+'|'strict-dynamic')/i.test(policy);
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

class InjectionState {
  constructor(siteId, requireNonce) {
    this.siteId = siteId;
    this.requireNonce = requireNonce;
    this.existingTracker = false;
    this.nonce = null;
  }
}

class ScriptHandler {
  constructor(state) {
    this.state = state;
  }

  element(element) {
    const src = element.getAttribute("src") ?? "";
    const configuredSiteId = element.getAttribute("data-site-id");
    if (src.includes("/api/script.js") || src.includes(`${PATH_PREFIX}/script.js`)) {
      this.state.existingTracker = true;
    }
    if (configuredSiteId === String(this.state.siteId)) {
      this.state.existingTracker = true;
    }
    if (!this.state.nonce && element.getAttribute("nonce")) {
      this.state.nonce = element.getAttribute("nonce");
    }
  }
}

class HeadHandler {
  constructor(state) {
    this.state = state;
  }

  element(element) {
    element.onEndTag(endTag => {
      if (this.state.existingTracker || (this.state.requireNonce && !this.state.nonce)) return;

      const nonce = this.state.nonce ? ` nonce="${escapeAttribute(this.state.nonce)}"` : "";
      endTag.before(
        `<script src="${PATH_PREFIX}/script.js" data-site-id="${this.state.siteId}" defer${nonce}></script>`,
        { html: true }
      );
    });
  }
}

async function proxyAnalytics(request, url) {
  const suffix = url.pathname.slice(PATH_PREFIX.length);
  const upstreamUrl = new URL(`/api${suffix}`, ANALYTICS_ORIGIN);
  upstreamUrl.search = url.search;

  const upstreamRequest = new Request(upstreamUrl, request);
  const response = await fetch(upstreamRequest);
  const headers = new Headers(response.headers);
  headers.set("x-bold-analytics-proxy", "1");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const hostname = url.hostname.toLowerCase();
    const siteId = SITE_MAP[hostname];

    if (!siteId) return fetch(request);
    if (url.pathname === PATH_PREFIX || url.pathname.startsWith(`${PATH_PREFIX}/`)) {
      return proxyAnalytics(request, url);
    }

    const response = await fetch(request);
    if (request.method !== "GET" || isExcludedPath(url.pathname) || !isHtmlResponse(response)) return response;

    const state = new InjectionState(siteId, needsNonce(response));
    return new HTMLRewriter()
      .on("script", new ScriptHandler(state))
      .on("head", new HeadHandler(state))
      .transform(response);
  },
};

export { escapeAttribute, isExcludedPath, isHtmlResponse, needsNonce };
