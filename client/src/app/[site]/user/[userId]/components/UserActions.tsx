"use client";

import { useExtracted } from "next-intl";
import { Trash2, UserPlus } from "lucide-react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchIdentitySettings } from "@/api/admin/endpoints";
import { UserInfo } from "@/api/analytics/endpoints";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DeleteUserDialog } from "./DeleteUserDialog";
import { IdentifyUserDialog } from "./IdentifyUserDialog";

interface UserActionsProps {
  userId: string;
  data: UserInfo;
}

export function UserActions({ userId, data }: UserActionsProps) {
  const t = useExtracted();
  const { site } = useParams<{ site: string }>();
  const [identifyOpen, setIdentifyOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const siteId = Number(site);
  const { data: identityResponse } = useQuery({
    queryKey: ["identity-settings", siteId],
    queryFn: () => fetchIdentitySettings(siteId),
    enabled: Number.isSafeInteger(siteId) && siteId > 0,
    staleTime: 60_000,
  });

  const isIdentified = !!data.identified_user_id;
  const canIdentify = !!identityResponse?.settings.enabled && !identityResponse.settings.complianceBlocked;

  return (
    <div className="flex items-center gap-1">
      {!isIdentified && canIdentify && (
        <Button size="sm" onClick={() => setIdentifyOpen(true)}>
          <UserPlus className="h-3.5 w-3.5 mr-1.5" />
          {t("Identify User")}
        </Button>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="smIcon"
            aria-label={t("Delete User")}
            className="text-neutral-500 hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("Delete User")}</TooltipContent>
      </Tooltip>

      {canIdentify && (
        <IdentifyUserDialog anonymousId={data.user_id || userId} open={identifyOpen} onOpenChange={setIdentifyOpen} />
      )}
      <DeleteUserDialog userId={userId} open={deleteOpen} onOpenChange={setDeleteOpen} />
    </div>
  );
}
