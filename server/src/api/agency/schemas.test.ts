import { describe, expect, it } from "vitest";
import { assignSiteSchema, createClientSchema, defaultSlug, reportScheduleSchema } from "./schemas.js";

describe("agency request schemas", () => {
  it("normalizes a client name into a stable slug", () => {
    expect(defaultSlug("  Café & Company LLC  ")).toBe("cafe-company-llc");
  });

  it("rejects an invalid timezone", () => {
    expect(createClientSchema.safeParse({ name: "Acme", timezone: "Phoenix-ish" }).success).toBe(false);
  });

  it("rejects invalid site identifiers", () => {
    expect(assignSiteSchema.safeParse({ siteId: "0" }).success).toBe(false);
  });

  it("requires a weekday for weekly schedules", () => {
    const result = reportScheduleSchema.safeParse({
      name: "Weekly summary",
      cadence: "weekly",
      timezone: "America/Phoenix",
      sendHour: 8,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a bounded monthly schedule", () => {
    const result = reportScheduleSchema.safeParse({
      name: "Monthly summary",
      cadence: "monthly",
      timezone: "America/Phoenix",
      dayOfMonth: 1,
      sendHour: 8,
      recipients: [{ name: "Client", email: "client@example.com" }],
    });
    expect(result.success).toBe(true);
  });
});
