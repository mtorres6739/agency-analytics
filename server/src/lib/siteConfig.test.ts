import { beforeEach, describe, expect, it, vi } from "vitest";
import { siteConfig } from "./siteConfig.js";

type SiteRow = {
  id: string | null;
  siteId: number;
  public: boolean | null;
  embedEnabled: boolean | null;
  saltUserIds: boolean | null;
  domain: string | null;
  blockBots: boolean;
  excludedIPs: unknown;
  excludedCountries: unknown;
  privateLinkKey: string | null;
  sessionReplay: boolean | null;
  webVitals: boolean | null;
  trackErrors: boolean | null;
  trackOutbound: boolean | null;
  trackUrlParams: boolean | null;
  trackInitialPageView: boolean | null;
  trackSpaNavigation: boolean | null;
  trackIp: boolean | null;
  trackButtonClicks: boolean | null;
  trackCopy: boolean | null;
  trackFormInteractions: boolean | null;
  tags: unknown;
};

type DrizzleCondition = {
  queryChunks?: Array<{
    name?: string;
    value?: unknown;
  }>;
};

const dbMock = vi.hoisted(() => ({
  rows: [] as SiteRow[],
  queries: [] as Array<{ column: string | undefined; value: unknown }>,
  select: vi.fn(),
}));

vi.mock("../db/postgres/postgres.js", () => ({
  db: {
    select: dbMock.select,
  },
}));

function createSiteRow(overrides: Partial<SiteRow>): SiteRow {
  return {
    id: "abcdef123456",
    siteId: 123,
    public: false,
    embedEnabled: false,
    saltUserIds: false,
    domain: "example.com",
    blockBots: true,
    excludedIPs: [],
    excludedCountries: [],
    privateLinkKey: null,
    sessionReplay: false,
    webVitals: false,
    trackErrors: false,
    trackOutbound: true,
    trackUrlParams: true,
    trackInitialPageView: true,
    trackSpaNavigation: true,
    trackIp: false,
    trackButtonClicks: false,
    trackCopy: false,
    trackFormInteractions: false,
    tags: [],
    ...overrides,
  };
}

function getConditionDetails(condition: DrizzleCondition): { column: string | undefined; value: unknown } {
  const column = condition.queryChunks?.find(chunk => chunk.name === "id" || chunk.name === "site_id")?.name;
  const value = condition.queryChunks?.find(
    chunk => Object.prototype.hasOwnProperty.call(chunk, "value") && !Array.isArray(chunk.value)
  )?.value;

  return { column, value };
}

beforeEach(() => {
  dbMock.rows.length = 0;
  dbMock.queries.length = 0;
  dbMock.select.mockReset();
  (siteConfig as unknown as { cache: Map<string, unknown> }).cache.clear();

  dbMock.select.mockImplementation(() => ({
    from: () => ({
      where: (condition: DrizzleCondition) => ({
        limit: async () => {
          const query = getConditionDetails(condition);
          dbMock.queries.push(query);

          const row = dbMock.rows.find(site => {
            if (query.column === "id") {
              return site.id === query.value;
            }

            if (query.column === "site_id") {
              return site.siteId === query.value;
            }

            return false;
          });

          return row ? [row] : [];
        },
      }),
    }),
  }));
});

describe("siteConfig.getConfig", () => {
  it("resolves digit-only string site IDs by exact sites.id before legacy site_id fallback", async () => {
    dbMock.rows.push(
      createSiteRow({
        id: "123456789012",
        siteId: 42,
        domain: "numeric-text-id.example",
      })
    );

    const config = await siteConfig.getConfig("123456789012");

    expect(config?.siteId).toBe(42);
    expect(config?.id).toBe("123456789012");
    expect(dbMock.queries).toEqual([{ column: "id", value: "123456789012" }]);
  });

  it("falls back to legacy numeric site_id when a numeric string has no exact sites.id match", async () => {
    dbMock.rows.push(
      createSiteRow({
        id: "abcdef123456",
        siteId: 21,
        domain: "legacy-id.example",
      })
    );

    const config = await siteConfig.getConfig("21");

    expect(config?.siteId).toBe(21);
    expect(config?.id).toBe("abcdef123456");
    expect(dbMock.queries).toEqual([
      { column: "id", value: "21" },
      { column: "site_id", value: 21 },
    ]);
  });

  it("keeps numeric and string cache keys separate", async () => {
    dbMock.rows.push(
      createSiteRow({
        id: "123",
        siteId: 99,
      }),
      createSiteRow({
        id: "abcdef123456",
        siteId: 123,
      })
    );

    const exactTextConfig = await siteConfig.getConfig("123");
    const legacyConfig = await siteConfig.getConfig(123);

    expect(exactTextConfig?.siteId).toBe(99);
    expect(legacyConfig?.siteId).toBe(123);
    expect(dbMock.queries).toEqual([
      { column: "id", value: "123" },
      { column: "site_id", value: 123 },
    ]);
  });
});
