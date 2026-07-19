"use client";

import { BarChart3, Building2, ChevronDown, FileText, LayoutDashboard, Menu, Settings, X } from "lucide-react";
import { useExtracted } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { OrganizationSelector } from "../OrganizationSelector";
import { cn } from "../../lib/utils";

function NavItems({ pathname }: { pathname: string }) {
  const t = useExtracted();
  const navigation = [
    { href: "/portfolio", label: t("Portfolio"), icon: LayoutDashboard },
    { href: "/clients", label: t("Clients"), icon: Building2 },
    { href: "/reports", label: t("Reports"), icon: FileText },
    { href: "/settings/organization", label: t("Settings"), icon: Settings },
  ];
  return (
    <nav className="space-y-1 px-3 py-4" aria-label={t("Agency navigation")}>
      {navigation.map(item => {
        const active = pathname === item.href || (item.href !== "/portfolio" && pathname.startsWith(`${item.href}/`));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
              active
                ? "bg-accent-50 text-accent-800 dark:bg-accent-950/50 dark:text-accent-200"
                : "text-neutral-650 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-350 dark:hover:bg-neutral-850 dark:hover:text-white"
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AgencyShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const t = useExtracted();

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-950 dark:bg-neutral-950 dark:text-white">
      <aside className="fixed inset-y-0 start-0 z-40 hidden w-64 border-e border-neutral-200 bg-white lg:block dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex h-16 items-center gap-3 border-b border-neutral-200 px-5 dark:border-neutral-800">
          <span className="grid size-9 place-items-center rounded-xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950">
            <BarChart3 className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{t("Agency Analytics")}</p>
            <p className="truncate text-xs text-neutral-500">{t("Private analytics workspace")}</p>
          </div>
        </div>
        <div className="border-b border-neutral-200 p-3 dark:border-neutral-800">
          <OrganizationSelector />
        </div>
        <NavItems pathname={pathname} />
      </aside>

      <div
        id="agency-mobile-sidebar"
        className="hs-overlay fixed inset-y-0 start-0 z-[80] hidden w-72 -translate-x-full border-e border-neutral-200 bg-white transition-all duration-300 hs-overlay-open:translate-x-0 lg:hidden dark:border-neutral-800 dark:bg-neutral-900"
        role="dialog"
        tabIndex={-1}
        aria-label={t("Agency navigation")}
      >
        <div className="flex h-16 items-center justify-between border-b border-neutral-200 px-4 dark:border-neutral-800">
          <span className="font-semibold">{t("Agency Analytics")}</span>
          <button
            type="button"
            className="rounded-lg p-2 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:bg-neutral-800"
            data-hs-overlay="#agency-mobile-sidebar"
            aria-label={t("Close navigation")}
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="border-b border-neutral-200 p-3 dark:border-neutral-800">
          <OrganizationSelector />
        </div>
        <NavItems pathname={pathname} />
      </div>

      <div className="lg:ps-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-neutral-200 bg-white/95 px-4 backdrop-blur sm:px-6 dark:border-neutral-800 dark:bg-neutral-900/95">
          <button
            type="button"
            className="rounded-lg p-2 hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 lg:hidden dark:hover:bg-neutral-800"
            data-hs-overlay="#agency-mobile-sidebar"
            aria-controls="agency-mobile-sidebar"
            aria-label={t("Open navigation")}
          >
            <Menu className="size-5" />
          </button>
          <div className="hidden text-sm text-neutral-500 sm:block">{t("All client analytics in one place")}</div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
          >
            {t("Site analytics")}
            <ChevronDown className="size-4 -rotate-90" aria-hidden="true" />
          </Link>
        </header>
        <main className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
