"use client";

import { useEffect, useState } from "react";
import { useExtracted } from "next-intl";
import { KeyRound, ShieldCheck } from "lucide-react";
import {
  fetchIdentitySettings,
  rotateIdentityKey,
  updateIdentitySettings,
  type IdentitySettings,
  type IdentityTraitKey,
} from "@/api/admin/endpoints";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { SettingRow, SettingsSection, SettingsSections } from "./SettingsSection";

const TRAITS: IdentityTraitKey[] = ["name", "email", "company", "plan"];

export function IdentityTab({ siteId, disabled = false }: { siteId: number; disabled?: boolean }) {
  const t = useExtracted();
  const [settings, setSettings] = useState<IdentitySettings | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const response = await fetchIdentitySettings(siteId);
    setSettings(response.settings);
  };

  useEffect(() => {
    void reload().catch(() => toast.error(t("Failed to load identity settings")));
  }, [siteId]);

  useEffect(() => {
    if (settings?.rotationStatus !== "pending") return;
    const timer = window.setInterval(() => void reload(), 5_000);
    return () => window.clearInterval(timer);
  }, [settings?.rotationStatus, siteId]);

  const patch = async (input: Parameters<typeof updateIdentitySettings>[1]) => {
    setBusy(true);
    try {
      const response = await updateIdentitySettings(siteId, input);
      setSettings(response.settings);
      toast.success(t("Identity settings updated"));
    } catch {
      toast.error(t("Failed to update identity settings"));
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    setBusy(true);
    try {
      await rotateIdentityKey(siteId);
      await reload();
      toast.success(t("Identity key deployment started"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Identity key deployment failed"));
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return <div className="h-32 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-850" />;

  return (
    <SettingsSections>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
        <div className="flex gap-2">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {t(
              "Identification stores personal data. Enable it only after the site's privacy and compliance review is complete."
            )}
          </p>
        </div>
      </div>
      {settings.complianceBlocked && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
          {settings.complianceReason}
        </div>
      )}
      <SettingsSection title={t("Verified identity")}>
        <SettingRow
          label={t("Identify delivered leads")}
          htmlFor="identity-enabled"
          description={t("Accept only short-lived signed assertions from the website backend")}
        >
          <Switch
            id="identity-enabled"
            checked={settings.enabled}
            disabled={disabled || busy || !settings.keyConfigured || settings.complianceBlocked}
            onCheckedChange={enabled => void patch({ enabled })}
          />
        </SettingRow>
        <SettingRow
          label={t("Signing key")}
          description={
            settings.rotationStatus === "pending"
              ? t("Deploying key version {version} to {project}", {
                  version: String(settings.keyVersion ?? "—"),
                  project: settings.deploymentProject ?? t("website"),
                })
              : settings.keyConfigured
                ? t("Key version {version} is configured", { version: String(settings.keyVersion ?? "—") })
                : t("Create and deploy a key before enabling identity")
          }
        >
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || busy || settings.rotationStatus === "pending" || settings.complianceBlocked}
            onClick={rotate}
          >
            <KeyRound className="mr-2 h-4 w-4" />
            {settings.rotationStatus === "pending"
              ? t("Deploying…")
              : settings.keyConfigured
                ? t("Rotate key")
                : t("Create key")}
          </Button>
        </SettingRow>
      </SettingsSection>
      <SettingsSection title={t("Allowed profile fields")}>
        <div className="grid grid-cols-2 gap-3 p-4">
          {TRAITS.map(trait => (
            <label key={trait} className="flex items-center gap-2 text-sm capitalize">
              <Checkbox
                checked={settings.allowedTraits.includes(trait)}
                disabled={
                  disabled || busy || (settings.allowedTraits.length === 1 && settings.allowedTraits[0] === trait)
                }
                onCheckedChange={checked => {
                  const allowedTraits = checked
                    ? [...new Set([...settings.allowedTraits, trait])]
                    : settings.allowedTraits.filter(value => value !== trait);
                  void patch({ allowedTraits });
                }}
              />
              {trait}
            </label>
          ))}
        </div>
      </SettingsSection>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {t(
          "Profiles are retained for {days} days. Phone numbers, messages, service details, and free-text are rejected.",
          {
            days: String(settings.retentionDays),
          }
        )}
      </p>
    </SettingsSections>
  );
}
