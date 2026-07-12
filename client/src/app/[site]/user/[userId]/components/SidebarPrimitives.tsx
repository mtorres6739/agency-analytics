import { ReactNode } from "react";
import { Skeleton } from "../../../../../components/ui/skeleton";

// Reusable card wrapper for sidebar sections
export function SidebarCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`bg-white dark:bg-neutral-900 rounded-lg border border-neutral-100 dark:border-neutral-850 p-4 ${className}`}
    >
      {children}
    </div>
  );
}

// Info row component for consistent styling
export function InfoRow({ icon, label, value }: { icon?: ReactNode; label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-neutral-50 dark:border-neutral-850 last:border-0 text-xs">
      <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="text-neutral-700 dark:text-neutral-200 flex items-center gap-1.5">
        {icon}
        {value}
      </span>
    </div>
  );
}

// Skeleton matching InfoRow's shape, for card loading states
export function InfoRowSkeleton({ labelWidth = "w-14", valueWidth = "w-24", withIcon = false }: {
  labelWidth?: string;
  valueWidth?: string;
  withIcon?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-neutral-50 dark:border-neutral-850 last:border-0">
      <Skeleton className={`h-3 ${labelWidth} rounded`} />
      <div className="flex items-center gap-1.5">
        {withIcon && <Skeleton className="w-4 h-4 rounded" />}
        <Skeleton className={`h-3 ${valueWidth} rounded`} />
      </div>
    </div>
  );
}

// Stat card component
export function StatCard({
  icon,
  label,
  value,
  isLoading,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-0.5">
        <div className="text-[10px] text-neutral-500 dark:text-neutral-400 flex items-center gap-1 uppercase tracking-wide">
          <Skeleton className="w-3 h-3 rounded" />
          <Skeleton className="h-2.5 w-14 rounded" />
        </div>
        <Skeleton className="h-4 w-16 rounded" />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <div className="text-[10px] text-neutral-500 dark:text-neutral-400 flex items-center gap-1 uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className="text-sm">{value}</div>
    </div>
  );
}
