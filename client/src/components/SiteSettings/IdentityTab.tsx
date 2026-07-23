"use client";

import { useEffect, useRef, useState } from "react";
import { useExtracted } from "next-intl";
import { KeyRound, ScanSearch, ShieldCheck } from "lucide-react";
import {
  fetchIdentitySettings,
  fetchResolutionSettings,
  rotateIdentityKey,
  updateIdentitySettings,
  updateResolutionSettings,
  type IdentitySettings,
  type IdentityTraitKey,
  type SiteResolutionSettings,
} from "@/api/admin/endpoints";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/sonner";
import { SettingRow, SettingsSection, SettingsSections } from "./SettingsSection";

const TRAITS: IdentityTraitKey[] = ["name", "email", "company", "plan", "title", "linkedinUrl", "location"];

export function IdentityTab({ siteId, disabled = false }: { siteId: number; disabled?: boolean }) {
  const t = useExtracted();
  const [settings, setSettings] = useState<IdentitySettings | null>(null);
  const [resolution, setResolution] = useState<SiteResolutionSettings | null>(null);
  const confirmedResolution = useRef<SiteResolutionSettings | null>(null);
  const [resolutionBlock, setResolutionBlock] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    const [identityResponse, resolutionResponse] = await Promise.all([
      fetchIdentitySettings(siteId),
      fetchResolutionSettings(siteId),
    ]);
    setSettings(identityResponse.settings);
    confirmedResolution.current = resolutionResponse.settings;
    setResolution(resolutionResponse.settings);
    setResolutionBlock(resolutionResponse.complianceReason);
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

  const patchResolution = async (input: Parameters<typeof updateResolutionSettings>[1]) => {
    setBusy(true);
    try {
      const response = await updateResolutionSettings(siteId, input);
      confirmedResolution.current = response.settings;
      setResolution(response.settings);
      toast.success(t("Visitor resolution settings updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Failed to update visitor resolution settings"));
      setResolution(confirmedResolution.current);
      await reload().catch(() => toast.error(t("Failed to reload visitor resolution settings")));
    } finally {
      setBusy(false);
    }
  };

  if (!settings || !resolution) {
    return <div className="h-32 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-850" />;
  }

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
      <SettingsSection title={t("Consented visitor resolution")}>
        <div className="flex gap-2 border-b border-neutral-200 p-4 text-sm text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">
          <ScanSearch className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {t(
              "Runs only after affirmative identification consent. GPC, suppression, compliance blocks, and budgets always win."
            )}
          </p>
        </div>
        {resolutionBlock && (
          <div className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
            {resolutionBlock}
          </div>
        )}
        <SettingRow
          label={t("Enable visitor resolution")}
          description={
            resolution.shadowMode
              ? t("Shadow mode is on: matches will not create confirmed profiles")
              : t("Deterministic matches may create profiles after consent")
          }
        >
          <Switch
            checked={resolution.enabled}
            disabled={disabled || busy || resolution.complianceState !== "approved" || !!resolutionBlock}
            onCheckedChange={enabled => void patchResolution({ enabled })}
          />
        </SettingRow>
        <SettingRow label={t("Site type")} description={t("Consumer sites use CustomersAI; business sites use RB2B")}>
          <Select
            value={resolution.mode}
            disabled={disabled || busy}
            onValueChange={mode =>
              void patchResolution({
                mode: mode as "consumer" | "business",
                primaryProvider: mode === "consumer" ? "customers_ai" : "rb2b",
              })
            }
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="consumer">{t("Consumer / local")}</SelectItem>
              <SelectItem value="business">{t("B2B")}</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          label={t("Shadow mode")}
          description={t("Store candidates for accuracy review without linking profiles")}
        >
          <Switch
            checked={resolution.shadowMode}
            disabled={disabled || busy}
            onCheckedChange={shadowMode => void patchResolution({ shadowMode })}
          />
        </SettingRow>
        <SettingRow
          label={t("Resolution transport")}
          description={t("Use server API when available; pixel mode uses the SDM-owned connector")}
        >
          <Select
            value={resolution.transport}
            disabled={disabled || busy}
            onValueChange={transport => void patchResolution({ transport: transport as "server" | "pixel" })}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="server">{t("Server API")}</SelectItem>
              <SelectItem value="pixel">{t("SDM pixel bridge")}</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow
          label={t("PDL enrichment")}
          description={t("Use PDL only for candidates above the enrichment threshold")}
        >
          <Switch
            checked={resolution.enrichmentEnabled}
            disabled={disabled || busy}
            onCheckedChange={enrichmentEnabled =>
              void patchResolution({ enrichmentEnabled, enrichmentProvider: enrichmentEnabled ? "pdl" : null })
            }
          />
        </SettingRow>
        <SettingRow
          label={t("Daily request cap")}
          description={t("Hard stop before another provider request is queued")}
        >
          <input
            type="number"
            min={0}
            value={resolution.dailyCap}
            disabled={disabled || busy}
            onChange={event => setResolution({ ...resolution, dailyCap: Number(event.target.value) })}
            onBlur={() => void patchResolution({ dailyCap: resolution.dailyCap })}
            className="w-28 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
          />
        </SettingRow>
        <SettingRow label={t("Monthly budget")} description={t("Cannot exceed the locked $750 pilot cap")}>
          <div className="flex items-center gap-2 text-sm">
            <span>$</span>
            <input
              type="number"
              min={0}
              max={750}
              value={resolution.monthlyBudgetCents / 100}
              disabled={disabled || busy}
              onChange={event =>
                setResolution({ ...resolution, monthlyBudgetCents: Math.round(Number(event.target.value) * 100) })
              }
              onBlur={() => void patchResolution({ monthlyBudgetCents: resolution.monthlyBudgetCents })}
              className="w-24 rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            />
          </div>
        </SettingRow>
      </SettingsSection>
    </SettingsSections>
  );
}
