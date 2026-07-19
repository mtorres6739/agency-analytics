"use client";

import { Loader2, Plus, X } from "lucide-react";
import { useExtracted } from "next-intl";
import { FormEvent, useState } from "react";
import { useCreateAgencyClient } from "../../api/agency/hooks/useAgencyClients";

export function CreateClientModal({ organizationId }: { organizationId: string }) {
  const t = useExtracted();
  const mutation = useCreateAgencyClient();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");

  async function submit(event: FormEvent) {
    event.preventDefault();
    await mutation.mutateAsync({ organizationId, data: { name, timezone } });
    setName("");
    document.getElementById("create-client-close")?.click();
  }

  return (
    <>
      <button
        type="button"
        data-hs-overlay="#create-client-modal"
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
      >
        <Plus className="size-4" />
        {t("Add client")}
      </button>
      <div
        id="create-client-modal"
        className="hs-overlay fixed inset-0 z-[90] hidden size-full overflow-y-auto bg-neutral-950/50"
        role="dialog"
        tabIndex={-1}
        aria-labelledby="create-client-title"
      >
        <div className="m-3 flex min-h-[calc(100%-1.5rem)] items-center justify-center opacity-0 transition-all hs-overlay-open:opacity-100 sm:mx-auto sm:w-full sm:max-w-lg">
          <form
            onSubmit={submit}
            className="w-full rounded-2xl border border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
          >
            <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
              <div>
                <h2 id="create-client-title" className="font-semibold">
                  {t("Create client")}
                </h2>
                <p className="mt-1 text-sm text-neutral-500">{t("This also creates the client access team.")}</p>
              </div>
              <button
                id="create-client-close"
                type="button"
                data-hs-overlay="#create-client-modal"
                className="rounded-lg p-2 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-neutral-800"
                aria-label={t("Close")}
              >
                <X className="size-5" />
              </button>
            </div>
            <div className="space-y-5 p-5">
              <label className="block">
                <span className="mb-2 block text-sm font-medium">{t("Client name")}</span>
                <input
                  required
                  minLength={2}
                  maxLength={120}
                  value={name}
                  onChange={event => setName(event.target.value)}
                  className="block w-full rounded-lg border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-accent-500 focus:ring-accent-500 dark:border-neutral-700 dark:bg-neutral-950"
                  placeholder={t("Acme Company")}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-medium">{t("Reporting timezone")}</span>
                <input
                  required
                  value={timezone}
                  onChange={event => setTimezone(event.target.value)}
                  className="block w-full rounded-lg border-neutral-300 bg-white px-3 py-2.5 text-sm focus:border-accent-500 focus:ring-accent-500 dark:border-neutral-700 dark:bg-neutral-950"
                />
              </label>
              {mutation.error ? (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {mutation.error.message}
                </p>
              ) : null}
            </div>
            <div className="flex justify-end gap-3 border-t border-neutral-200 px-5 py-4 dark:border-neutral-800">
              <button
                type="button"
                data-hs-overlay="#create-client-modal"
                className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                disabled={mutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-neutral-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-neutral-950"
              >
                {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("Create client")}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
