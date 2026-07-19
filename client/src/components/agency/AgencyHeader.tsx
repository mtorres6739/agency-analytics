import type { ReactNode } from "react";

export function AgencyHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-accent-700 dark:text-accent-300">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-550 dark:text-neutral-400">{description}</p>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tones: Record<string, string> = {
    active: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300",
    verified: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300",
    succeeded: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300",
    onboarding: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300",
    pending: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300",
    queued: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300",
    running: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/40 dark:text-blue-300",
    stale: "bg-orange-50 text-orange-800 ring-orange-600/20 dark:bg-orange-950/40 dark:text-orange-300",
    error: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/40 dark:text-red-300",
    failed: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/40 dark:text-red-300",
    paused: "bg-neutral-100 text-neutral-650 ring-neutral-500/20 dark:bg-neutral-800 dark:text-neutral-300",
    archived: "bg-neutral-100 text-neutral-650 ring-neutral-500/20 dark:bg-neutral-800 dark:text-neutral-300",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium capitalize ring-1 ring-inset ${tones[status] ?? tones.paused}`}
    >
      {status}
    </span>
  );
}
