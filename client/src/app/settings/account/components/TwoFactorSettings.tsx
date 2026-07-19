"use client";

import { authClient } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { useExtracted } from "next-intl";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

type SetupState = {
  totpURI: string;
  backupCodes: string[];
};

export function TwoFactorSettings() {
  const t = useExtracted();
  const session = authClient.useSession();
  const enabled = Boolean((session.data?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled);
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [setup, setSetup] = useState<SetupState>();
  const [qrCode, setQrCode] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!setup?.totpURI) return;
    QRCode.toDataURL(setup.totpURI, { width: 240, margin: 2, errorCorrectionLevel: "M" }).then(setQrCode);
  }, [setup]);

  const beginSetup = async () => {
    setIsLoading(true);
    const result = await authClient.twoFactor.enable({
      password: password || undefined,
      issuer: "Bold Analytics",
    });
    setIsLoading(false);
    if (result.error || !result.data) {
      toast.error(result.error?.message || t("Unable to start two-factor setup."));
      return;
    }
    setSetup(result.data);
    setPassword("");
  };

  const completeSetup = async () => {
    setIsLoading(true);
    const result = await authClient.twoFactor.verifyTotp({ code: verificationCode.replace(/\s/g, "") });
    setIsLoading(false);
    if (result.error) {
      toast.error(result.error.message || t("The verification code is invalid or expired."));
      return;
    }
    toast.success(t("Two-factor authentication is enabled."));
    setSetup(undefined);
    setVerificationCode("");
    setQrCode(undefined);
    await session.refetch();
  };

  const disable = async () => {
    setIsLoading(true);
    const result = await authClient.twoFactor.disable({ password: password || undefined });
    setIsLoading(false);
    if (result.error) {
      toast.error(result.error.message || t("Unable to disable two-factor authentication."));
      return;
    }
    setPassword("");
    toast.success(t("Two-factor authentication is disabled."));
    await session.refetch();
  };

  return (
    <div className="space-y-4" aria-live="polite">
      <div>
        <h4 className="text-sm font-medium">{t("Two-factor authentication")}</h4>
        <p className="mt-1 text-xs text-neutral-500">
          {enabled
            ? t("Your account requires an authenticator code when you sign in.")
            : t("Agency owners and administrators must enable two-factor authentication before production access.")}
        </p>
      </div>

      {!enabled && !setup && (
        <div className="max-w-sm space-y-3">
          <label htmlFor="two-factor-password" className="block text-sm font-medium">
            {t("Current password")}
            <span className="ml-1 text-xs font-normal text-neutral-500">{t("if your account uses one")}</span>
          </label>
          <Input
            id="two-factor-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
          <Button className="min-h-11" onClick={beginSetup} disabled={isLoading}>
            {isLoading ? t("Preparing...") : t("Set up authenticator")}
          </Button>
        </div>
      )}

      {!enabled && setup && (
        <div className="space-y-5 rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
          <div>
            <h5 className="font-medium">{t("1. Scan this code")}</h5>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {t("Use 1Password, Google Authenticator, Authy, or another TOTP application.")}
            </p>
            {qrCode && (
              // The URI is also available as text below, so this QR image is decorative for screen readers.
              <img src={qrCode} alt="" width={240} height={240} className="mt-3 rounded-lg border bg-white p-2" />
            )}
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-medium">{t("Cannot scan the code?")}</summary>
              <code className="mt-2 block break-all rounded bg-neutral-100 p-3 text-xs dark:bg-neutral-800">
                {setup.totpURI}
              </code>
            </details>
          </div>

          <div>
            <h5 className="font-medium">{t("2. Save your backup codes")}</h5>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">
              {t("Each code can be used once. Store them somewhere separate from this account.")}
            </p>
            <ul className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-neutral-100 p-3 font-mono text-sm dark:bg-neutral-800">
              {setup.backupCodes.map(code => (
                <li key={code}>{code}</li>
              ))}
            </ul>
          </div>

          <div className="max-w-sm space-y-3">
            <label htmlFor="two-factor-verification" className="block text-sm font-medium">
              {t("3. Enter the six-digit code")}
            </label>
            <Input
              id="two-factor-verification"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={verificationCode}
              onChange={event => setVerificationCode(event.target.value)}
              placeholder="123456"
            />
            <Button className="min-h-11" onClick={completeSetup} disabled={isLoading || !verificationCode.trim()}>
              {isLoading ? t("Verifying...") : t("Verify and enable")}
            </Button>
          </div>
        </div>
      )}

      {enabled && (
        <div className="max-w-sm space-y-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            {t("Two-factor authentication is active.")}
          </div>
          <label htmlFor="disable-two-factor-password" className="block text-sm font-medium">
            {t("Current password")}
          </label>
          <Input
            id="disable-two-factor-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
          <Button variant="outline" className="min-h-11" onClick={disable} disabled={isLoading}>
            {t("Disable two-factor authentication")}
          </Button>
        </div>
      )}
    </div>
  );
}
