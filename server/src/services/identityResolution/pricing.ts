import type { IdentityProvider } from "@rybbit/shared";

export type BillableIdentityProvider = IdentityProvider | "pdl";

function parseInteger(value: string | undefined, options: { min: number; max?: number }): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < options.min || (options.max !== undefined && parsed > options.max)) {
    return null;
  }
  return parsed;
}

export function getProviderCostMicros(provider: BillableIdentityProvider): number | null {
  return parseInteger(process.env[`${provider.toUpperCase()}_COST_MICROS`], { min: 1 });
}

export function getPilotBudgetCents(): number | null {
  const configured = process.env.IDENTITY_PILOT_MONTHLY_BUDGET_CENTS;
  if (configured === undefined || configured.trim() === "") return 75_000;
  return parseInteger(configured, { min: 0, max: 75_000 });
}
