import { afterEach, describe, expect, it } from "vitest";
import { getPilotBudgetCents, getProviderCostMicros } from "./pricing.js";

const originalBudget = process.env.IDENTITY_PILOT_MONTHLY_BUDGET_CENTS;
const originalCustomersAiCost = process.env.CUSTOMERS_AI_COST_MICROS;

afterEach(() => {
  if (originalBudget === undefined) delete process.env.IDENTITY_PILOT_MONTHLY_BUDGET_CENTS;
  else process.env.IDENTITY_PILOT_MONTHLY_BUDGET_CENTS = originalBudget;
  if (originalCustomersAiCost === undefined) delete process.env.CUSTOMERS_AI_COST_MICROS;
  else process.env.CUSTOMERS_AI_COST_MICROS = originalCustomersAiCost;
});

describe("identity provider pricing", () => {
  it("requires a positive finite integer provider cost", () => {
    for (const value of [undefined, "", "0", "-1", "1.5", "NaN", "Infinity"]) {
      if (value === undefined) delete process.env.CUSTOMERS_AI_COST_MICROS;
      else process.env.CUSTOMERS_AI_COST_MICROS = value;
      expect(getProviderCostMicros("customers_ai")).toBeNull();
    }
    process.env.CUSTOMERS_AI_COST_MICROS = "125000";
    expect(getProviderCostMicros("customers_ai")).toBe(125_000);
  });

  it("defaults the pilot cap to $750 and rejects invalid or excessive values", () => {
    delete process.env.IDENTITY_PILOT_MONTHLY_BUDGET_CENTS;
    expect(getPilotBudgetCents()).toBe(75_000);
    for (const value of ["-1", "75001", "1.5", "NaN", "Infinity"]) {
      process.env.IDENTITY_PILOT_MONTHLY_BUDGET_CENTS = value;
      expect(getPilotBudgetCents()).toBeNull();
    }
    process.env.IDENTITY_PILOT_MONTHLY_BUDGET_CENTS = "0";
    expect(getPilotBudgetCents()).toBe(0);
  });
});
