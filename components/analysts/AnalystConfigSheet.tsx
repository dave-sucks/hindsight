"use client";

import { useTransition } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  AnalystConfigForm,
  type FormValues,
  type FormChangeHandler,
} from "@/components/analysts/AnalystConfigForm";
import {
  updateAnalystField,
  addAnalystMonitor,
  removeAnalystMonitor,
} from "@/lib/actions/analyst.actions";
import type { AnalystConfig } from "@/lib/actions/analyst.actions";

interface AnalystConfigSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: AnalystConfig;
  /** Live prices keyed by symbol, forwarded to the Monitors-tab watchlist. */
  livePrices?: Record<string, number>;
}

// Sheet wrapper — shown from the analyst detail header. Adapts the DB-shape
// AnalystConfig into the form's canonical FormValues, and pipes per-field
// onChange straight to updateAnalystField on the server.
export function AnalystConfigSheet({
  open,
  onOpenChange,
  config,
  livePrices,
}: AnalystConfigSheetProps) {
  const [, startTransition] = useTransition();

  const values: FormValues = {
    name: config.name,
    description: config.description,
    analystPrompt: config.analystPrompt,
    watchlist: config.watchlist,
    sources: config.domainMonitors.map((m) => ({
      id: m.id,
      name: m.name,
      domain: m.domain,
    })),
    searchQueries: config.searchMonitors.map((m) => ({
      id: m.id,
      query: m.query,
    })),
    directionBias: (config.directionBias as FormValues["directionBias"]) ?? "BOTH",
    holdDurations: config.holdDurations,
    minConfidence: config.minConfidence,
    maxOpenPositions: config.maxOpenPositions,
    minPositionSize: config.minPositionSize,
    maxPositionSize: config.maxPositionSize,
    tradingEnvironment: config.tradingEnvironment,
    realMaxPosition: config.realMaxPosition,
    runDaysOfWeek: config.runDaysOfWeek,
    emailAlerts: config.emailAlerts,
    intelligencePolicy: (config.intelligencePolicy as FormValues["intelligencePolicy"]) ?? null,
    sectors: config.sectors,
    industries: config.industries,
    themes: config.themes,
    feeds: config.feeds,
    marketCapMin: config.marketCapMin,
    marketCapMax: config.marketCapMax,
    exclusionList: config.exclusionList,
  };

  const handleChange: FormChangeHandler = (field, value) => {
    // The form's FormValues field names align 1:1 with UpdatableField for
    // every persisted field. Fields the form surfaces but the server doesn't
    // accept never call this: sources + searchQueries mutate via add/remove
    // handlers below; intelligencePolicy is display-only; tradingEnvironment is
    // read-only context here (promotion/demotion runs through the Promote
    // dialog, which force-closes positions — not a plain field write).
    if (
      field === "sources" ||
      field === "searchQueries" ||
      field === "intelligencePolicy" ||
      field === "tradingEnvironment"
    ) {
      return;
    }
    startTransition(async () => {
      await updateAnalystField(
        config.id,
        field as Parameters<typeof updateAnalystField>[1],
        value,
      );
    });
  };

  // Mirrors SegmentConfigSheet's wiring (components/podcasts/SegmentConfigSheet.tsx).
  // Same shape, same Monitor table — just scope=ANALYST + analystId instead
  // of PODCAST_SEGMENT + podcastSegmentId.
  const handleAddDomain = async (input: { name: string; domain: string }) => {
    await addAnalystMonitor(config.id, { type: "DOMAIN", ...input });
  };

  const handleAddSearch = async (input: { name?: string; query: string }) => {
    await addAnalystMonitor(config.id, { type: "SEARCH", ...input });
  };

  const handleRemoveMonitor = async (monitorId: string) => {
    await removeAnalystMonitor(monitorId);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-[420px] sm:max-w-[420px] flex flex-col p-0"
      >
        <SheetHeader className="shrink-0 px-3 pt-3">
          <SheetTitle className="text-sm font-semibold">Configuration</SheetTitle>
          <SheetDescription className="text-xs">
            Edit settings directly or use the AI chat.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0">
          <AnalystConfigForm
            values={values}
            onChange={handleChange}
            livePrices={livePrices}
            onAddDomainMonitor={handleAddDomain}
            onAddSearchMonitor={handleAddSearch}
            onRemoveMonitor={handleRemoveMonitor}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
