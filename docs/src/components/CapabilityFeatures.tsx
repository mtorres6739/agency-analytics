"use client";

import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { ActivityIcon } from "@/components/ui/activity";
import { ArrowDownIcon } from "@/components/ui/arrow-down";
import { BanIcon } from "@/components/ui/ban";
import { BellIcon } from "@/components/ui/bell";
import { BotIcon } from "@/components/ui/bot";
import { DownloadIcon } from "@/components/ui/download";
import { EarthIcon } from "@/components/ui/earth";
import { GaugeIcon } from "@/components/ui/gauge";
import { LayersIcon } from "@/components/ui/layers";
import { LinkIcon } from "@/components/ui/link";
import { PlayIcon } from "@/components/ui/play";
import { RouteIcon } from "@/components/ui/route";
import { ShieldCheckIcon } from "@/components/ui/shield-check";
import { TerminalIcon } from "@/components/ui/terminal";
import { UsersIcon } from "@/components/ui/users";
import { ZapIcon } from "@/components/ui/zap";

// The template is a server component, so features arrive as serializable
// data and the icon components are resolved here by key.
const ICONS = {
  zap: ZapIcon,
  activity: ActivityIcon,
  gauge: GaugeIcon,
  bell: BellIcon,
  play: PlayIcon,
  route: RouteIcon,
  earth: EarthIcon,
  users: UsersIcon,
  "arrow-down": ArrowDownIcon,
  layers: LayersIcon,
  link: LinkIcon,
  download: DownloadIcon,
  bot: BotIcon,
  ban: BanIcon,
  "shield-check": ShieldCheckIcon,
  terminal: TerminalIcon,
} as const;

export type CapabilityIconKey = keyof typeof ICONS;

interface CapabilityFeature {
  icon: CapabilityIconKey;
  title: string;
  description: string;
}

interface CapabilityFeaturesProps {
  features: CapabilityFeature[];
  iconClassName: string;
}

interface IconHandle {
  startAnimation: () => void;
  stopAnimation: () => void;
}

/**
 * One capability group's feature list. The self-drawing icons redraw with a
 * short stagger when the group scrolls into view (their resting state is the
 * fully drawn glyph, so no-JS and reduced-motion render complete icons), and
 * hovering a row redraws its icon.
 */
export function CapabilityFeatures({ features, iconClassName }: CapabilityFeaturesProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const iconRefs = useRef<(IconHandle | null)[]>([]);
  const prefersReducedMotion = useReducedMotion();
  const isInView = useInView(rootRef, { once: true, amount: 0.35 });

  useEffect(() => {
    if (!isInView || prefersReducedMotion) return;
    const timers = iconRefs.current.map((handle, index) =>
      setTimeout(() => handle?.startAnimation(), index * 120)
    );
    return () => timers.forEach(clearTimeout);
  }, [isInView, prefersReducedMotion]);

  return (
    <div
      ref={rootRef}
      className="mt-8 divide-y divide-neutral-200 border-t border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800"
    >
      {features.map((feature, index) => {
        const Icon = ICONS[feature.icon];
        return (
          <div
            key={feature.title}
            className="grid grid-cols-[24px_1fr] gap-x-3 py-4"
            onMouseEnter={prefersReducedMotion ? undefined : () => iconRefs.current[index]?.startAnimation()}
          >
            <Icon
              size={18}
              className={`mt-0.5 ${iconClassName}`}
              ref={handle => {
                iconRefs.current[index] = handle;
              }}
            />
            <div>
              <h4 className="text-sm font-medium">{feature.title}</h4>
              <p className="mt-1 text-sm leading-5 text-neutral-600 dark:text-neutral-400">{feature.description}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
