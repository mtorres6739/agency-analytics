"use client";

import { useState } from "react";
import { useExtracted } from "next-intl";
import { useGetSite } from "../../../../../api/admin/hooks/useSites";
import { useJourneys } from "../../../../../api/analytics/hooks/useGetJourneys";
import { Card, CardContent } from "../../../../../components/ui/card";
import { Slider } from "../../../../../components/ui/slider";
import { useStore } from "../../../../../lib/store";
import { SankeyDiagram } from "../../../journeys/components/SankeyDiagram";

const MAX_JOURNEYS = 50;

export function UserJourneys({ userId }: { userId: string }) {
  const t = useExtracted();
  const [steps, setSteps] = useState<number>(3);

  const { data: siteMetadata } = useGetSite();
  const { time } = useStore();

  const { data, isLoading, error } = useJourneys({
    siteId: siteMetadata?.siteId,
    steps,
    time,
    limit: MAX_JOURNEYS,
    additionalFilters: [{ parameter: "user_id", value: [userId], type: "equals" }],
  });

  const journeys = data?.journeys ?? [];

  return (
    <Card>
      <CardContent className="mt-2">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{t("Journeys")}</h3>
          <div className="flex items-center gap-3 w-[160px]">
            <span className="text-sm text-neutral-600 dark:text-neutral-300 whitespace-nowrap">
              {t("{steps} steps", { steps: String(steps) })}
            </span>
            <Slider
              value={[steps]}
              onValueChange={([value]) => setSteps(value)}
              min={2}
              max={6}
              step={1}
              className="flex-1"
            />
          </div>
        </div>
        <div className="relative min-h-[80px]">
          {isLoading && (
            <div className="absolute inset-0 bg-white/30 dark:bg-neutral-900/30 backdrop-blur-sm z-10 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <div className="h-8 w-8 rounded-full border-2 border-accent-400 border-t-transparent animate-spin"></div>
                <span className="text-sm text-neutral-600 dark:text-neutral-300">{t("Loading journey data...")}</span>
              </div>
            </div>
          )}
          {journeys.length > 0 && siteMetadata?.domain ? (
            <SankeyDiagram journeys={journeys} steps={steps} maxJourneys={MAX_JOURNEYS} domain={siteMetadata.domain} />
          ) : null}
          {error && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 py-4">
              {t("Failed to load journey data. Please try again.")}
            </p>
          )}
          {journeys.length === 0 && !isLoading && !error && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 py-4">
              {t("No journey data found for the selected criteria.")}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
