import { AlertTriangle, FolderOpen } from "lucide-react";
import type { ReactNode } from "react";

export function AgencyLoading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading analytics">
      <div className="h-9 w-64 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800" />
    </div>
  );
}

export function AgencyEmpty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-white px-6 py-14 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <FolderOpen className="mx-auto mb-4 size-8 text-neutral-400" aria-hidden="true" />
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function AgencyError({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-medium">Unable to load analytics</p>
          <p className="mt-1 text-sm opacity-80">{message}</p>
          {retry ? (
            <button
              type="button"
              onClick={retry}
              className="mt-3 rounded-lg border border-current px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
            >
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
