"use client";

import { useExtracted } from "next-intl";
import { ReactNode } from "react";

import { useGetSiteUsage } from "@/api/admin/hooks/useSites";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { SettingsSection, SettingsSections } from "./SettingsSection";

interface UsageTabProps {
  siteId: number;
}

function formatPercent(value: number): string {
  if (value === 0) {
    return "0";
  }
  if (value < 0.1) {
    return "<0.1";
  }
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

interface UsageStatProps {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  /** 0-100 fill for the bottom bar; omit to hide the bar */
  percent?: number;
  exceeded?: boolean;
}

function UsageStat({ label, value, caption, percent, exceeded }: UsageStatProps) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-neutral-150 p-3 pb-4 dark:border-neutral-800">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums text-foreground">{value}</div>
      {caption && <div className="mt-0.5 text-xs text-muted-foreground">{caption}</div>}
      {percent !== undefined && (
        <div className="absolute bottom-0 left-0 h-1 w-full bg-neutral-100 dark:bg-neutral-800">
          <div
            className={cn("h-1", exceeded ? "bg-red-500" : "bg-accent-400/75")}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function UsageTab({ siteId }: UsageTabProps) {
  const t = useExtracted();
  const { data: usage, isLoading, error } = useGetSiteUsage(siteId);

  return (
    <SettingsSections>
      <SettingsSection description={t("Usage resets at the start of each calendar month.")}>
        {isLoading || !usage ? (
          error ? (
            <p className="text-sm text-red-600 dark:text-red-400">{t("Failed to load usage")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Skeleton className="h-[92px] rounded-lg" />
              <Skeleton className="h-[92px] rounded-lg" />
              <Skeleton className="h-[92px] rounded-lg" />
            </div>
          )
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <UsageStat
              label={t("Events this month")}
              value={usage.siteEventsThisMonth.toLocaleString()}
              caption={
                usage.orgEventsThisMonth > 0
                  ? t("{percent}% of your organization's events", {
                      percent: formatPercent((usage.siteEventsThisMonth / usage.orgEventsThisMonth) * 100),
                    })
                  : undefined
              }
              percent={usage.orgEventsThisMonth > 0 ? (usage.siteEventsThisMonth / usage.orgEventsThisMonth) * 100 : 0}
            />
            <UsageStat
              label={t("Organization events")}
              value={`${usage.orgEventsThisMonth.toLocaleString()} / ${
                usage.orgEventLimit === null ? t("Unlimited") : usage.orgEventLimit.toLocaleString()
              }`}
              percent={
                usage.orgEventLimit !== null && usage.orgEventLimit > 0
                  ? (usage.orgEventsThisMonth / usage.orgEventLimit) * 100
                  : undefined
              }
              exceeded={usage.orgEventLimit !== null && usage.orgEventsThisMonth >= usage.orgEventLimit}
            />
            <UsageStat
              label={t("Projected by month end")}
              value={usage.projectedSiteEvents === null ? "—" : usage.projectedSiteEvents.toLocaleString()}
              caption={
                usage.projectedSiteEvents === null
                  ? t("Not enough data yet")
                  : usage.orgEventLimit !== null && usage.orgEventLimit > 0
                    ? t("{percent}% of your organization's event limit", {
                        percent: formatPercent((usage.projectedSiteEvents / usage.orgEventLimit) * 100),
                      })
                    : undefined
              }
              percent={
                usage.projectedSiteEvents !== null && usage.orgEventLimit !== null && usage.orgEventLimit > 0
                  ? (usage.projectedSiteEvents / usage.orgEventLimit) * 100
                  : undefined
              }
              exceeded={
                usage.projectedSiteEvents !== null &&
                usage.orgEventLimit !== null &&
                usage.projectedSiteEvents >= usage.orgEventLimit
              }
            />
          </div>
        )}
      </SettingsSection>
    </SettingsSections>
  );
}
