"use client";

import { AuthButton } from "@/components/auth/AuthButton";
import { AuthError } from "@/components/auth/AuthError";
import { AuthInput } from "@/components/auth/AuthInput";
import { authClient } from "@/lib/auth";
import { userStore } from "@/lib/userStore";
import { useExtracted } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TwoFactorChallengePage() {
  const t = useExtracted();
  const router = useRouter();
  const [method, setMethod] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setIsLoading(true);

    const result =
      method === "totp"
        ? await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ""), trustDevice: false })
        : await authClient.twoFactor.verifyBackupCode({ code: code.trim(), trustDevice: false });

    if (result.error) {
      setError(result.error.message || t("The verification code is invalid or expired."));
      setIsLoading(false);
      return;
    }

    const session = await authClient.getSession();
    if (session.data?.user) userStore.setState({ user: session.data.user, isPending: false });
    router.replace("/portfolio");
  };

  return (
    <main
      id="main-content"
      className="flex min-h-dvh items-center justify-center bg-neutral-50 px-4 dark:bg-neutral-950"
    >
      <section
        aria-labelledby="two-factor-title"
        className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900 sm:p-8"
      >
        <p className="mb-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">{t("Secure sign in")}</p>
        <h1 id="two-factor-title" className="text-2xl font-semibold tracking-tight">
          {t("Two-factor authentication")}
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-300">
          {method === "totp"
            ? t("Enter the six-digit code from your authenticator app.")
            : t("Enter one of your single-use backup codes.")}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-2" role="group" aria-label={t("Verification method")}>
          <button
            type="button"
            aria-pressed={method === "totp"}
            onClick={() => {
              setMethod("totp");
              setCode("");
              setError(undefined);
            }}
            className="min-h-11 rounded-lg border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 aria-pressed:border-emerald-600 aria-pressed:bg-emerald-50 dark:aria-pressed:bg-emerald-950"
          >
            {t("Authenticator")}
          </button>
          <button
            type="button"
            aria-pressed={method === "backup"}
            onClick={() => {
              setMethod("backup");
              setCode("");
              setError(undefined);
            }}
            className="min-h-11 rounded-lg border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 aria-pressed:border-emerald-600 aria-pressed:bg-emerald-50 dark:aria-pressed:bg-emerald-950"
          >
            {t("Backup code")}
          </button>
        </div>

        <form onSubmit={verify} className="mt-6 space-y-4">
          <AuthInput
            id="two-factor-code"
            label={method === "totp" ? t("Authentication code") : t("Backup code")}
            type="text"
            inputMode={method === "totp" ? "numeric" : "text"}
            autoComplete="one-time-code"
            required
            value={code}
            onChange={event => setCode(event.target.value)}
            placeholder={method === "totp" ? "123456" : "xxxx-xxxx"}
          />
          <AuthError error={error} title={t("Verification failed")} />
          <AuthButton isLoading={isLoading} loadingText={t("Verifying...")} disabled={!code.trim() || isLoading}>
            {t("Verify and continue")}
          </AuthButton>
        </form>
      </section>
    </main>
  );
}
