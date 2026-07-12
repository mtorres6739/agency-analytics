"use client";

import { useExtracted, useLocale } from "next-intl";
import { SessionsList } from "@/components/Sessions/SessionsList";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import { DateTime } from "luxon";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useUserInfo } from "../../../../api/analytics/hooks/userGetInfo";
import { useGetSessions, useGetUserSessionCount } from "../../../../api/analytics/hooks/useGetUserSessions";
import { DateSelector } from "../../../../components/DateSelector/DateSelector";
import { Button } from "../../../../components/ui/button";
import { canGoForward, goBack, goForward, useStore } from "../../../../lib/store";
import { USER_DETAIL_PAGE_FILTERS } from "../../../../lib/filterGroups";
import { Filters } from "../../components/SubHeader/Filters/Filters";
import { NewFilterButton } from "../../components/SubHeader/Filters/NewFilterButton";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../../../../components/ui/breadcrumb";
import { useSetPageTitle } from "../../../../hooks/useSetPageTitle";
import { useGetRegionName } from "../../../../lib/geo";
import { userStore } from "../../../../lib/userStore";
import { MobileSidebar } from "../../components/Sidebar/MobileSidebar";
import { UserActions } from "./components/UserActions";
import { UserSidebar } from "./components/UserSidebar";
import { Skeleton } from "../../../../components/ui/skeleton";
import { Avatar, generateName } from "../../../../components/Avatar";
import { Badge } from "../../../../components/ui/badge";
import { IdentifiedBadge } from "../../../../components/IdentifiedBadge";
import { UserTopPages } from "./components/UserTopPages";

const LIMIT = 25;

export default function UserPage() {
  useSetPageTitle("User");
  const t = useExtracted();

  const locale = useLocale();
  const { userId: rawUserId, site } = useParams();
  const { user } = userStore();
  const { time, setTime } = useStore();
  const userId = (() => {
    const value = Array.isArray(rawUserId) ? rawUserId[0] : rawUserId;
    if (!value) return "";
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  })();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useUserInfo(Number(site), userId);
  const { data: sessionCount } = useGetUserSessionCount(userId);
  const { data: sessionsData, isLoading: isLoadingSessions } = useGetSessions({
    userId,
    page: page,
    limit: LIMIT + 1,
  });

  const allSessions = sessionsData?.data || [];
  const hasNextPage = allSessions.length > LIMIT;
  const sessions = allSessions.slice(0, LIMIT);
  const hasPrevPage = page > 1;

  const { getRegionName } = useGetRegionName();

  const traitsUsername = data?.traits?.username as string | undefined;
  const traitsName = data?.traits?.name as string | undefined;
  const traitsEmail = data?.traits?.email as string | undefined;
  const isIdentified = !!data?.identified_user_id;
  const displayName = traitsUsername || traitsName || (isIdentified ? userId : generateName(userId));

  // The user's clock, from the timezone captured on their latest event
  const localTime = data?.timezone ? DateTime.now().setZone(data.timezone) : null;
  const localTimeValid = localTime?.isValid ? localTime : null;
  const timezoneCity = data?.timezone?.split("/").pop()?.replace(/_/g, " ");

  return (
    <div className="p-2 md:p-4 max-w-[1200px] mx-auto">
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href={`/${site}/users`}>{t("Users")}</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem className="min-w-0">
            <BreadcrumbPage className="truncate">{isLoading ? t("Loading...") : displayName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {/* Header */}
      <div className="flex items-center gap-2 mt-2 mb-3">
        <MobileSidebar />
        <div className="hidden md:block">
          <NewFilterButton availableFilters={USER_DETAIL_PAGE_FILTERS} />
        </div>
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <DateSelector time={time} setTime={setTime} />
          <div className="flex items-center">
            <Button
              variant="secondary"
              size="icon"
              onClick={goBack}
              disabled={time.mode === "past-minutes"}
              className="rounded-r-none h-8 w-8"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={goForward}
              disabled={!canGoForward(time)}
              className="rounded-l-none -ml-px h-8 w-8"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>
      <div className="md:hidden mb-2">
        <NewFilterButton availableFilters={USER_DETAIL_PAGE_FILTERS} />
      </div>
      <Filters availableFilters={USER_DETAIL_PAGE_FILTERS} />

      <div className="flex items-center gap-4 mb-4">
        <Avatar size={64} id={userId} />
        <div className="mt-3 w-full flex gap-2">
          <div>
            <div className="font-semibold text-lg flex items-center gap-2">
              {isLoading ? <Skeleton className="h-6 w-32" /> : displayName}
              {!isLoading && isIdentified && (
                <IdentifiedBadge traits={data?.traits} userId={data?.identified_user_id} />
              )}
            </div>
            {isLoading ? (
              <div className="flex flex-col items-center gap-1 mt-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24" />
              </div>
            ) : (
              <>
                {traitsEmail && <p className="text-neutral-500 dark:text-neutral-400 text-sm mt-0.5">{traitsEmail}</p>}
                <p className="text-neutral-400 dark:text-neutral-500 text-xs font-mono mt-1 truncate">{userId}</p>
              </>
            )}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {localTimeValid && (
            <Badge
              variant="outline"
              className="text-xs whitespace-nowrap"
              title={`${t("Local time")} · ${data?.timezone}`}
            >
              <Clock className="w-3 h-3 mr-1 text-neutral-400 dark:text-neutral-500" />
              {localTimeValid.setLocale(locale).toLocaleString(DateTime.TIME_SIMPLE)}
              {timezoneCity && <span className="text-neutral-400 dark:text-neutral-500 ml-1">{timezoneCity}</span>}
            </Badge>
          )}
          {data?.ip && (
            <Badge variant="outline" className="text-xs whitespace-nowrap">
              IP: {data.ip}
            </Badge>
          )}
          {user && data && <UserActions userId={userId} data={data} />}
        </div>
      </div>

      {/* Main two-column layout */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Left Sidebar */}
        <UserSidebar
          data={data}
          isLoading={isLoading}
          sessionCount={sessionCount?.data ?? []}
          getRegionName={getRegionName}
        />

        {/* Right Content - Sessions */}
        <div className="flex-1 min-w-0 space-y-4">
          <UserTopPages userId={userId} />
          <SessionsList
            sessions={sessions}
            isLoading={isLoadingSessions}
            page={page}
            onPageChange={setPage}
            hasNextPage={hasNextPage}
            hasPrevPage={hasPrevPage}
            userId={userId}
          />
        </div>
      </div>
    </div>
  );
}
