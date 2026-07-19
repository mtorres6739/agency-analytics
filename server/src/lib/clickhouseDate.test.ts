import { describe, expect, it } from "vitest";
import { formatClickHouseDateTime64 } from "./clickhouseDate.js";

describe("formatClickHouseDateTime64", () => {
  it("formats a UTC date without the unsupported ISO timezone suffix", () => {
    expect(formatClickHouseDateTime64(new Date("2026-07-19T19:49:21.123Z"))).toBe("2026-07-19 19:49:21.123");
  });
});
