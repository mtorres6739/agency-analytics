"use client";

import { useExtracted } from "next-intl";
import { getTimezone } from "@/lib/store";
import { Calendar, CalendarCheck, Clock, Files, Globe, Laptop, Monitor, Pencil, Smartphone, Tablet } from "lucide-react";
import { DateTime } from "luxon";
import { useState } from "react";
import { Avatar, generateName } from "../../../../../components/Avatar";
import { Badge } from "../../../../../components/ui/badge";
import { Button } from "../../../../../components/ui/button";
import { IdentifiedBadge } from "../../../../../components/IdentifiedBadge";
import { useDateTimeFormat } from "../../../../../hooks/useDateTimeFormat";
import { formatDuration } from "../../../../../lib/dateTimeUtils";
import { VisitCalendar } from "./Calendar";
import { EventIcon, PageviewIcon } from "../../../../../components/EventIcons";
import { UserInfo, UserSessionCountResponse } from "../../../../../api/analytics/endpoints";
import { ChannelIcon, extractDomain, getDisplayName } from "../../../../../components/Channel";
import { Favicon } from "../../../../../components/Favicon";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../../../components/ui/tooltip";
import { useConfigs } from "../../../../../lib/configs";
import { userStore } from "../../../../../lib/userStore";
import { PerformanceMetric } from "../../../performance/performanceStore";
import {
  formatMetricValue,
  getMetricColor,
  getMetricUnit,
  METRIC_LABELS,
  METRIC_LABELS_SHORT,
} from "../../../performance/utils/performanceUtils";
import { EditTraitsDialog } from "../../../../../components/EditTraitsDialog";
import { LocationDevices } from "./LocationDevices";
import { InfoRow, InfoRowSkeleton, SidebarCard, StatCard } from "./SidebarPrimitives";
import { UserLocationMap } from "./UserLocationMap";

interface UserSidebarProps {
  data: UserInfo | undefined;
  isLoading: boolean;
  sessionCount: UserSessionCountResponse[];
  getRegionName: (region: string) => string;
}

const VITALS_ORDER: PerformanceMetric[] = ["lcp", "cls", "inp", "fcp", "ttfb"];

export function UserSidebar({ data, isLoading, sessionCount, getRegionName }: UserSidebarProps) {
  const t = useExtracted();
  const { formatRelative } = useDateTimeFormat();
  const { configs } = useConfigs();
  const { user } = userStore();
  const [traitsOpen, setTraitsOpen] = useState(false);
  const isIdentified = !!data?.identified_user_id;

  // Filter custom traits (exclude username, name, email)
  const customTraits = data?.traits
    ? Object.entries(data.traits).filter(([key]) => !["username", "name", "email"].includes(key))
    : [];

  const firstReferrerDomain = data?.first_referrer ? extractDomain(data.first_referrer) : null;
  const channelChanged = !!data?.last_channel && data.last_channel !== data.first_channel;
  const vitals = data?.vitals ?? null;
  const vitalsToShow = vitals
    ? VITALS_ORDER.filter(metric => vitals[`${metric}_p75`] != null)
    : [];

  return (
    <div className="w-full lg:w-[300px] md:shrink-0 space-y-3">
      {/* Stats Grid */}
      <SidebarCard>
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            icon={<Files className="w-3 h-3" />}
            label={t("Sessions")}
            value={data?.sessions ?? "—"}
            isLoading={isLoading}
          />
          <StatCard
            icon={<PageviewIcon className="w-3 h-3" />}
            label={t("Pageviews")}
            value={data?.pageviews ?? "—"}
            isLoading={isLoading}
          />
          <StatCard
            icon={<EventIcon className="w-3 h-3" />}
            label={t("Events")}
            value={data?.events ?? "—"}
            isLoading={isLoading}
          />
          <StatCard
            icon={<Clock className="w-3 h-3" />}
            label={t("Avg Duration")}
            value={data?.duration ? formatDuration(data.duration) : "—"}
            isLoading={isLoading}
          />
          <StatCard
            icon={<Calendar className="w-3 h-3" />}
            label={t("First Seen")}
            value={
              data?.first_seen
                ? DateTime.fromSQL(data.first_seen, { zone: "utc" }).setZone(getTimezone()).toLocaleString(DateTime.DATE_MED)
                : "—"
            }
            isLoading={isLoading}
          />
          <StatCard
            icon={<CalendarCheck className="w-3 h-3" />}
            label={t("Last Seen")}
            value={
              data?.last_seen
                ? DateTime.fromSQL(data.last_seen, { zone: "utc" }).setZone(getTimezone()).toLocaleString(DateTime.DATE_MED)
                : "—"
            }
            isLoading={isLoading}
          />
        </div>
      </SidebarCard>

      {/* Acquisition (first-touch attribution) */}
      <SidebarCard>
        <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">
          {t("Acquisition")}
        </h3>
        {isLoading ? (
          <div>
            <InfoRowSkeleton labelWidth="w-14" valueWidth="w-24" withIcon />
            <InfoRowSkeleton labelWidth="w-12" valueWidth="w-20" withIcon />
            <InfoRowSkeleton labelWidth="w-16" valueWidth="w-28" />
          </div>
        ) : (
          <div>
            <InfoRow
              icon={data?.first_channel ? <ChannelIcon channel={data.first_channel} className="w-3.5 h-3.5" /> : undefined}
              label={t("Channel")}
              value={data?.first_channel || "—"}
            />
            <InfoRow
              icon={firstReferrerDomain ? <Favicon domain={firstReferrerDomain} className="w-3.5 h-3.5" /> : undefined}
              label={t("Referrer")}
              value={firstReferrerDomain ? getDisplayName(firstReferrerDomain) : "—"}
            />
            <InfoRow
              label={t("Landing page")}
              value={
                data?.first_entry_page ? (
                  <span className="truncate max-w-[160px] inline-block" title={data.first_entry_page}>
                    {data.first_entry_page}
                  </span>
                ) : (
                  "—"
                )
              }
            />
            {data?.first_utm_source && (
              <InfoRow
                label={t("Source")}
                value={<span className="truncate max-w-[160px] inline-block">{data.first_utm_source}</span>}
              />
            )}
            {data?.first_utm_medium && (
              <InfoRow
                label={t("Medium")}
                value={<span className="truncate max-w-[160px] inline-block">{data.first_utm_medium}</span>}
              />
            )}
            {data?.first_utm_campaign && (
              <InfoRow
                label={t("Campaign")}
                value={<span className="truncate max-w-[160px] inline-block">{data.first_utm_campaign}</span>}
              />
            )}
            {channelChanged && (
              <InfoRow
                icon={<ChannelIcon channel={data.last_channel} className="w-3.5 h-3.5" />}
                label={t("Latest channel")}
                value={data.last_channel}
              />
            )}
          </div>
        )}
      </SidebarCard>

      {/* Location & Device Info */}
      <SidebarCard>
        <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">
          {t("Location & Device")}
        </h3>
        <LocationDevices data={data} isLoading={isLoading} getRegionName={getRegionName} />
      </SidebarCard>

      {/* Activity Calendar */}
      <SidebarCard className="h-[180px]">
        <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2">
          {t("Activity Calendar")}
        </h3>
        <div className="h-[140px]">
          <VisitCalendar sessionCount={sessionCount} />
        </div>
      </SidebarCard>

      {/* Web Vitals (p75 across this user's performance events) */}
      {vitals && vitalsToShow.length > 0 && (
        <SidebarCard>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
              {t("Web Vitals")}
            </h3>
            <span className="text-[10px] text-neutral-400 dark:text-neutral-500 uppercase tracking-wide">p75</span>
          </div>
          <div>
            {vitalsToShow.map(metric => {
              const value = vitals[`${metric}_p75`] as number;
              return (
                <InfoRow
                  key={metric}
                  label={
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-default">{METRIC_LABELS_SHORT[metric]}</span>
                      </TooltipTrigger>
                      <TooltipContent>{METRIC_LABELS[metric]}</TooltipContent>
                    </Tooltip>
                  }
                  value={
                    <span className={getMetricColor(metric, value)}>
                      {formatMetricValue(metric, value)}
                      {getMetricUnit(metric, value)}
                    </span>
                  }
                />
              );
            })}
          </div>
        </SidebarCard>
      )}

      {/* User Traits (identified users only) */}
      {isIdentified && data && (customTraits.length > 0 || !!user) && (
        <SidebarCard>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
              {t("User Traits")}
            </h3>
            {user && (
              <Button
                variant="ghost"
                size="smIcon"
                className="-my-1.5 -mr-1.5 h-6 w-6 text-neutral-500"
                aria-label={t("Edit Traits")}
                onClick={() => setTraitsOpen(true)}
              >
                <Pencil className="w-3 h-3" />
              </Button>
            )}
          </div>
          {customTraits.length > 0 ? (
            <div className="space-y-1">
              {customTraits.map(([key, value]) => (
                <div
                  key={key}
                  className="flex items-center justify-between py-1 border-b border-neutral-50 dark:border-neutral-850 last:border-0 text-xs"
                >
                  <span className="text-neutral-500 dark:text-neutral-400 capitalize">{key.replace(/_/g, " ")}</span>
                  <span className="text-neutral-700 dark:text-neutral-200 truncate max-w-[160px]">{String(value)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">{t("No traits yet")}</p>
          )}
          <EditTraitsDialog
            userId={data.identified_user_id}
            traits={data.traits}
            open={traitsOpen}
            onOpenChange={setTraitsOpen}
          />
        </SidebarCard>
      )}

      {/* Location Map */}
      {configs?.mapboxToken && data?.country && (
        <div className="bg-white dark:bg-neutral-900 rounded-lg border border-neutral-100 dark:border-neutral-850 aspect-square overflow-hidden">
          <UserLocationMap
            country={data.country}
            region={data.region}
            city={data.city}
          />
        </div>
      )}

      {/* Linked Devices (identified users only) */}
      {/* {isIdentified && data?.linked_devices && data.linked_devices.length > 0 && (
        <SidebarCard>
          <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <Laptop className="w-3 h-3" />
            Linked Devices ({data.linked_devices.length})
          </h3>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {data.linked_devices.map(device => (
              <div
                key={device.anonymous_id}
                className="flex items-center justify-between py-1 border-b border-neutral-50 dark:border-neutral-850 last:border-0"
              >
                <span className="text-neutral-600 dark:text-neutral-300 font-mono text-xs truncate max-w-[140px]">
                  {device.anonymous_id}
                </span>
                <span className="text-neutral-400 dark:text-neutral-500 text-xs">
                  {formatRelative(DateTime.fromISO(device.created_at))}
                </span>
              </div>
            ))}
          </div>
        </SidebarCard>
      )} */}
    </div>
  );
}
