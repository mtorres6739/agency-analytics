import { z } from "zod";

const slug = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens");

const timezone = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(value => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid IANA timezone");

export const createClientSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: slug.optional(),
  timezone: timezone.default("UTC"),
  logoUrl: z.string().url().max(2048).nullable().optional(),
  externalRef: z.string().trim().max(255).nullable().optional(),
});

export const updateClientSchema = createClientSchema
  .partial()
  .extend({ status: z.enum(["onboarding", "active", "paused", "archived"]).optional() })
  .refine(value => Object.keys(value).length > 0, "At least one field is required");

export const assignSiteSchema = z.object({
  siteId: z.coerce.number().int().positive(),
  isPrimary: z.boolean().default(false),
  trackingMethod: z.enum(["script", "gtm", "cms", "proxy"]).default("script"),
});

const recipientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  locale: z.string().trim().min(2).max(20).default("en"),
  enabled: z.boolean().default(true),
});

const reportScheduleBaseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  cadence: z.enum(["weekly", "monthly"]),
  timezone,
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  sendHour: z.number().int().min(0).max(23),
  siteScope: z.array(z.number().int().positive()).default([]),
  enabled: z.boolean().default(true),
  recipients: z.array(recipientSchema).max(50).default([]),
});

export const reportScheduleSchema = reportScheduleBaseSchema.superRefine((value, context) => {
  if (value.cadence === "weekly" && value.weekday == null) {
    context.addIssue({ code: "custom", path: ["weekday"], message: "Weekday is required for weekly reports" });
  }
  if (value.cadence === "monthly" && value.dayOfMonth == null) {
    context.addIssue({ code: "custom", path: ["dayOfMonth"], message: "Day of month is required for monthly reports" });
  }
});

export const updateReportScheduleSchema = reportScheduleBaseSchema
  .partial()
  .refine(value => Object.keys(value).length > 0, {
    message: "At least one field is required",
  });

export function defaultSlug(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
