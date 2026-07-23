import { eq, type SQL } from "drizzle-orm";
import { db } from "../db/postgres/postgres.js";
import { siteResolutionSettings, sites } from "../db/postgres/schema.js";
import { matchesCIDR, matchesRange } from "./ipUtils.js";
import { logger } from "./logger/logger.js";

// Site configuration interface
export interface SiteConfigData {
  id: string | null;
  siteId: number;
  type: "web" | "mobile";
  public: boolean;
  embedEnabled: boolean;
  saltUserIds: boolean;
  domain: string;
  blockBots: boolean;
  excludedIPs: string[];
  excludedCountries: string[];
  excludedPaths: string[];
  excludedHostnames: string[];
  excludedUserAgents: string[];
  privateLinkKey?: string | null;
  sessionReplay: boolean;
  webVitals: boolean;
  trackErrors: boolean;
  trackOutbound: boolean;
  trackUrlParams: boolean;
  trackInitialPageView: boolean;
  trackSpaNavigation: boolean;
  trackIp: boolean;
  trackButtonClicks: boolean;
  trackCopy: boolean;
  trackFormInteractions: boolean;
  tags: string[];
  identityResolution?: {
    enabled: boolean;
    complianceState: string;
    policyVersion: string;
    primaryProvider: string;
    transport: string;
  };
}

type SiteConfigRow = {
  site: typeof sites.$inferSelect;
  identityResolution: {
    enabled: boolean;
    complianceState: string;
    policyVersion: string;
    primaryProvider: string;
    transport: string;
  } | null;
};

class SiteConfig {
  private cache = new Map<string, { data: SiteConfigData; expires: number }>();
  private cacheTTL = 60 * 1000; // 1 minute TTL

  /**
   * Helper to determine if the input can be interpreted as a legacy numeric siteId
   */
  private isNumericId(id: string | number): boolean {
    if (typeof id === "number") {
      return Number.isInteger(id);
    }

    return /^\d+$/.test(id);
  }

  private getCacheKey(siteIdOrId: string | number): string {
    return `${typeof siteIdOrId}:${siteIdOrId}`;
  }

  private async querySiteConfig(where: SQL): Promise<SiteConfigRow | undefined> {
    const [site] = await db
      .select({
        site: sites,
        identityResolution: {
          enabled: siteResolutionSettings.enabled,
          complianceState: siteResolutionSettings.complianceState,
          policyVersion: siteResolutionSettings.policyVersion,
          primaryProvider: siteResolutionSettings.primaryProvider,
          transport: siteResolutionSettings.transport,
        },
      })
      .from(sites)
      .leftJoin(siteResolutionSettings, eq(siteResolutionSettings.siteId, sites.siteId))
      .where(where)
      .limit(1);

    return site;
  }

  private async findSiteByIdentifier(siteIdOrId: string | number): Promise<SiteConfigRow | undefined> {
    if (typeof siteIdOrId === "number") {
      return Number.isInteger(siteIdOrId) ? this.querySiteConfig(eq(sites.siteId, siteIdOrId)) : undefined;
    }

    const siteByExactId = await this.querySiteConfig(eq(sites.id, siteIdOrId));
    if (siteByExactId || !this.isNumericId(siteIdOrId)) {
      return siteByExactId;
    }

    return this.querySiteConfig(eq(sites.siteId, Number(siteIdOrId)));
  }

  /**
   * Get site by either siteId or id
   */
  private async getSiteByAnyId(siteIdOrId: string | number): Promise<SiteConfigData | undefined> {
    const cacheKey = this.getCacheKey(siteIdOrId);
    const cached = this.cache.get(cacheKey);

    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    try {
      const site = await this.findSiteByIdentifier(siteIdOrId);

      if (!site) {
        return undefined;
      }

      const row = site.site;
      const configData: SiteConfigData = {
        id: row.id,
        siteId: row.siteId,
        type: row.type || "web",
        public: row.public || false,
        embedEnabled: row.embedEnabled || false,
        saltUserIds: row.saltUserIds || false,
        domain: row.domain || "",
        blockBots: row.blockBots === undefined ? true : row.blockBots,
        excludedIPs: Array.isArray(row.excludedIPs) ? row.excludedIPs : [],
        excludedCountries: Array.isArray(row.excludedCountries) ? row.excludedCountries : [],
        excludedPaths: Array.isArray(row.excludedPaths) ? row.excludedPaths : [],
        excludedHostnames: Array.isArray(row.excludedHostnames) ? row.excludedHostnames : [],
        excludedUserAgents: Array.isArray(row.excludedUserAgents) ? row.excludedUserAgents : [],
        privateLinkKey: row.privateLinkKey,
        sessionReplay: row.sessionReplay || false,
        webVitals: row.webVitals || false,
        trackErrors: row.trackErrors || false,
        trackOutbound: row.trackOutbound ?? true,
        trackUrlParams: row.trackUrlParams ?? true,
        trackInitialPageView: row.trackInitialPageView ?? true,
        trackSpaNavigation: row.trackSpaNavigation ?? true,
        trackIp: row.trackIp || false,
        trackButtonClicks: row.trackButtonClicks || false,
        trackCopy: row.trackCopy || false,
        trackFormInteractions: row.trackFormInteractions || false,
        tags: Array.isArray(row.tags) ? row.tags : [],
        identityResolution: {
          enabled: site.identityResolution?.enabled ?? false,
          complianceState: site.identityResolution?.complianceState ?? "pending",
          policyVersion: site.identityResolution?.policyVersion ?? "identity-v1",
          primaryProvider: site.identityResolution?.primaryProvider ?? "customers_ai",
          transport: site.identityResolution?.transport ?? "server",
        },
      };

      this.cache.set(cacheKey, {
        data: configData,
        expires: Date.now() + this.cacheTTL,
      });

      return configData;
    } catch (error) {
      logger.error(error as Error, `Error fetching site configuration for ${siteIdOrId}`);
      return undefined;
    }
  }

  /**
   * Get the full site configuration
   */
  async getConfig(siteIdOrId?: string | number): Promise<SiteConfigData | undefined> {
    if (!siteIdOrId) return undefined;
    return this.getSiteByAnyId(siteIdOrId);
  }

  clearCache(): void {
    this.cache.clear();
  }

  async updateConfig(
    siteIdOrId: number | string,
    config: Partial<Omit<SiteConfigData, "identityResolution">>
  ): Promise<void> {
    try {
      const isNumeric = this.isNumericId(siteIdOrId);
      await db
        .update(sites)
        .set(config)
        .where(isNumeric ? eq(sites.siteId, Number(siteIdOrId)) : eq(sites.id, String(siteIdOrId)));

      // Invalidate cache after update
      this.cache.clear();
    } catch (error) {
      logger.error(error as Error, `Error updating site configuration for ${siteIdOrId}`);
    }
  }

  /**
   * Add a new site
   */
  async addSite(config: Omit<SiteConfigData, "siteId" | "identityResolution">): Promise<void> {
    try {
      await db.insert(sites).values({
        id: config.id,
        name: "", // This would need to be provided
        domain: config.domain,
        public: config.public,
        saltUserIds: config.saltUserIds,
        blockBots: config.blockBots,
        excludedIPs: config.excludedIPs,
        createdBy: "", // This would need to be provided
      });
    } catch (error) {
      logger.error(error as Error, `Error adding site`);
    }
  }

  /**
   * Remove a site
   */
  async removeSite(siteIdOrId: number | string): Promise<void> {
    const isNumeric = this.isNumericId(siteIdOrId);

    await db.delete(sites).where(isNumeric ? eq(sites.siteId, Number(siteIdOrId)) : eq(sites.id, String(siteIdOrId)));

    // Database failures must propagate so callers never report a false
    // successful delete while the site configuration still exists.
    this.cache.clear();
  }

  /**
   * Check if an IP address matches any of the excluded IPs/ranges
   */
  async isIPExcluded(ipAddress: string, siteIdOrId?: string | number): Promise<boolean> {
    if (!siteIdOrId) return false; // If no site specified, don't exclude any IPs
    const config = await this.getSiteByAnyId(siteIdOrId);
    const excludedIPs = config?.excludedIPs || [];
    if (!excludedIPs || excludedIPs.length === 0) {
      return false;
    }

    for (const excludedPattern of excludedIPs) {
      if (this.matchesIPPattern(ipAddress, excludedPattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a country code is in the excluded countries list
   * @param countryIso - ISO country code (e.g., "US", "GB", "CN")
   * @param siteIdOrId - Site identifier
   * @returns true if country should be excluded
   */
  async isCountryExcluded(countryIso: string | undefined, siteIdOrId?: string | number): Promise<boolean> {
    if (!siteIdOrId || !countryIso) return false;
    const config = await this.getSiteByAnyId(siteIdOrId);
    const excludedCountries = config?.excludedCountries || [];
    if (!excludedCountries || excludedCountries.length === 0) {
      return false;
    }

    // Convert to uppercase for case-insensitive comparison
    const normalizedCountry = countryIso.toUpperCase();
    return excludedCountries.some(country => country.toUpperCase() === normalizedCountry);
  }

  /**
   * Check if a pathname matches any of the excluded path glob patterns.
   * Patterns support `*` as a wildcard (e.g. "/admin/*", "/preview"). Matching is case-insensitive.
   */
  async isPathExcluded(pathname: string | undefined, siteIdOrId?: string | number): Promise<boolean> {
    if (!siteIdOrId || !pathname) return false;
    const config = await this.getSiteByAnyId(siteIdOrId);
    const excludedPaths = config?.excludedPaths || [];
    return excludedPaths.some(pattern => this.matchesGlob(pathname, pattern));
  }

  /**
   * Check if a hostname matches any of the excluded hostname glob patterns.
   * Patterns support `*` as a wildcard (e.g. "localhost", "*.vercel.app"). Matching is case-insensitive.
   */
  async isHostnameExcluded(hostname: string | undefined, siteIdOrId?: string | number): Promise<boolean> {
    if (!siteIdOrId || !hostname) return false;
    const config = await this.getSiteByAnyId(siteIdOrId);
    const excludedHostnames = config?.excludedHostnames || [];
    return excludedHostnames.some(pattern => this.matchesGlob(hostname, pattern));
  }

  /**
   * Check if a user-agent string contains any of the excluded substrings.
   * Matching is a case-insensitive substring test (e.g. "HeadlessChrome").
   */
  async isUserAgentExcluded(userAgent: string | undefined, siteIdOrId?: string | number): Promise<boolean> {
    if (!siteIdOrId || !userAgent) return false;
    const config = await this.getSiteByAnyId(siteIdOrId);
    const excludedUserAgents = config?.excludedUserAgents || [];
    const normalizedUserAgent = userAgent.toLowerCase();
    return excludedUserAgents.some(substring => {
      const trimmed = substring.trim().toLowerCase();
      return trimmed.length > 0 && normalizedUserAgent.includes(trimmed);
    });
  }

  /**
   * Case-insensitive glob match where `*` matches any sequence of characters
   * (including the empty string). A pattern with no wildcards must match the
   * whole value exactly.
   *
   * Implemented as a linear two-pointer scan rather than a compiled RegExp so
   * that, on the hot ingestion path, we (1) never recompile a pattern per event
   * and (2) can't trigger catastrophic backtracking — matching is bounded to
   * O(value.length * pattern.length) regardless of how many wildcards a pattern
   * contains. Every character other than `*` is treated as a literal.
   */
  private matchesGlob(value: string, pattern: string): boolean {
    const glob = pattern.trim().toLowerCase();
    if (!glob) return false;

    const text = value.toLowerCase();

    let textIdx = 0;
    let globIdx = 0;
    let lastStarGlobIdx = -1;
    let textIdxAfterStar = 0;

    while (textIdx < text.length) {
      if (globIdx < glob.length && glob[globIdx] === text[textIdx]) {
        // Literal character match — advance both pointers.
        textIdx++;
        globIdx++;
      } else if (globIdx < glob.length && glob[globIdx] === "*") {
        // Record this star and tentatively let it match nothing.
        lastStarGlobIdx = globIdx;
        textIdxAfterStar = textIdx;
        globIdx++;
      } else if (lastStarGlobIdx !== -1) {
        // Mismatch, but the most recent star can absorb one more character.
        globIdx = lastStarGlobIdx + 1;
        textIdxAfterStar++;
        textIdx = textIdxAfterStar;
      } else {
        return false;
      }
    }

    // The value is consumed; the match holds only if the rest of the pattern is
    // entirely trailing stars.
    while (globIdx < glob.length && glob[globIdx] === "*") {
      globIdx++;
    }

    return globIdx === glob.length;
  }

  /**
   * Check if an IP address matches a specific pattern
   * Supports:
   * - Single IP: 192.168.1.1, 2001:db8::1
   * - CIDR notation: 192.168.1.0/24, 2001:db8::/32
   * - Range notation: 192.168.1.1-192.168.1.10 (IPv4 only, IPv6 ranges not supported)
   */
  private matchesIPPattern(ipAddress: string, pattern: string): boolean {
    try {
      const trimmedPattern = pattern.trim();

      // Single IP match
      if (!trimmedPattern.includes("/") && !trimmedPattern.includes("-")) {
        return ipAddress === trimmedPattern;
      }

      // CIDR notation
      if (trimmedPattern.includes("/")) {
        return matchesCIDR(ipAddress, trimmedPattern);
      }

      // Range notation
      if (trimmedPattern.includes("-")) {
        return matchesRange(ipAddress, trimmedPattern);
      }

      return false;
    } catch (error) {
      logger.warn(error as Error, `Invalid IP pattern: ${pattern}`);
      return false;
    }
  }
}

// Singleton instance
export const siteConfig = new SiteConfig();
