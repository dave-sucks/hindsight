"use client";

/**
 * AgentChat — unified chat component for all three surfaces:
 *   - research-run: live agent run + follow-up conversation (tabs: Chat, Sources, Theses)
 *   - builder: analyst creation chat
 *   - editor: analyst editing chat
 *
 * The only chat component. Replaces AgentThread, AnalystBuilderChat,
 * AnalystChatProvider, and AnalystEditorChatWithInitial.
 * Uses the unified /api/agent/[mode] route.
 */

import { useMemo, useCallback, useTransition, useState } from "react";
import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import type { AgentMode } from "@/lib/agent/modes";
import { MODES, RESEARCH_MODEL_OPTIONS } from "@/lib/agent/modes";
import { ChatRuntime } from "@/components/chat/chat-runtime";
import { Thread, type WelcomeConfig } from "@/components/assistant-ui/thread";
import type { HindsightComposerFeatures } from "@/components/assistant-ui/hindsight-composer";
import { HindsightComposer } from "@/components/assistant-ui/hindsight-composer";
import { ToolUICallbacksProvider } from "@/components/assistant-ui/tool-uis";
import { useAutoSend } from "@/hooks/useAutoSend";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  createAnalystFromBuilder,
  updateAnalystFromBuilder,
} from "@/lib/actions/analyst.actions";
import type { AgentConfigData } from "@/components/domain/agent-config-card";
import { Sparkles, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RunSourcesPanel } from "@/components/research/run-sources-panel";
import { ThesisRow, type ThesisRowData } from "@/components/ui/thesis-row";
import { TranscriptRow, type TranscriptRowData } from "@/components/ui/transcript-row";
import type { RunSourceItem } from "@/lib/actions/run-sources.actions";
import type { MorningBrief as IntelMorningBrief } from "@/components/intelligence/types";

// ── Model preference storage key ──────────────────────────────────────────────
const MODEL_PREF_KEY = "hindsight_research_model";

function getStoredModel(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(MODEL_PREF_KEY);
}

function storeModel(value: string) {
  localStorage.setItem(MODEL_PREF_KEY, value);
}

// ── Default welcome configs + composer features per mode ──────────────────────

const BUILDER_WELCOME: WelcomeConfig = {
  title: "Create a new analyst",
  subtitle:
    "Describe the trading strategy you want — I'll build a custom analyst for you.",
  icon: (
    <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
      <Sparkles className="size-5" />
    </div>
  ),
};

const EDITOR_WELCOME: WelcomeConfig = {
  title: "Edit your analyst",
  subtitle: "Ask questions about the current strategy or suggest changes.",
};

// Podcast-builder welcome — see docs/PODCAST_PLAN.md.
const PODCAST_BUILDER_WELCOME: WelcomeConfig = {
  title: "Create a new podcast",
  subtitle:
    "Describe the show — topic, length, tone — and I'll set up the segments.",
  icon: (
    <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
      <Sparkles className="size-5" />
    </div>
  ),
};

const PODCAST_EDITOR_WELCOME: WelcomeConfig = {
  title: "Edit your podcast",
  subtitle: "Ask questions about the show or suggest changes.",
};

const BUILDER_COMPOSER: HindsightComposerFeatures = {
  tickerSearch: true,
  placeholder: "Describe your ideal trading analyst…",
};

const EDITOR_COMPOSER: HindsightComposerFeatures = {
  tickerSearch: true,
  placeholder: "Ask a question or suggest strategy changes…",
};

const PODCAST_BUILDER_COMPOSER: HindsightComposerFeatures = {
  placeholder: "What's the show about? How long are episodes? Daily or weekly?",
};

const PODCAST_EDITOR_COMPOSER: HindsightComposerFeatures = {
  placeholder: "Ask a question or suggest a change to the show…",
};

// podcast-segment-run welcome — shown briefly before the agent kicks off.
// Subtitle uses analystName which the run page passes as
// "Podcast Name · Segment Name" so the user knows which segment is running.
const PODCAST_SEGMENT_RUN_COMPOSER: HindsightComposerFeatures = {
  placeholder: "Ask a follow-up about the segment…",
};

// Principal chat (operator co-pilot at /chat) — welcome + composer.
// The page wraps AgentChat in a topSlot that renders the scope chip
// (Portfolio | @AnalystName), so the welcome subtitle stays static.
const PRINCIPAL_WELCOME: WelcomeConfig = {
  title: "Hindsight",
  subtitle:
    "Operator chat — review analysts, runs, monitors, theses; research stocks; place trades when scoped to an analyst.",
};

const PRINCIPAL_COMPOSER: HindsightComposerFeatures = {
  tickerSearch: true,
  slashCommands: true,
  placeholder:
    "Ask about your portfolio, an analyst, a ticker, or a thesis…",
};

// ── Props ─────────────────────────────────────────────────────────────────────

interface AgentChatProps {
  mode: AgentMode;

  // research-run
  runId?: string;
  analystId?: string;
  analystName?: string;
  /** podcast-editor — id of the podcast being edited (passed on body). */
  podcastId?: string;
  autoStart?: boolean;
  headerAction?: ReactNode;
  brief?: IntelMorningBrief | null;
  sources?: RunSourceItem[];
  theses?: ThesisRowData[];
  /** podcast-segment-run: the single transcript this run produced (mirror of theses for analyst runs). */
  transcript?: TranscriptRowData | null;

  // builder / editor
  currentConfig?: Record<string, unknown>;

  /** Pre-loaded messages for replay (historical runs) */
  messages?: UIMessage[];

  /** Thread composer slot (e.g. QuickReplies) */
  composerSlot?: ReactNode;

  /**
   * Principal-chat scope picker. When provided, the composer renders a
   * "Scope" submenu in the Settings2 dropdown so the user can rebind
   * which analyst writes target. When `current` is non-null, a
   * brand-green-dot chip + analyst name renders at the TOP of the
   * input. When null, no chip — unscoped is the silent default.
   */
  principalScope?: {
    current: { id: string; name: string } | null;
    options: Array<{ id: string; name: string; enabled: boolean }>;
    onChange: (analystId: string | null) => void;
  };

  /** Auto-send initial message (builder/editor) */
  initialPrompt?: string;

  /**
   * Called when the AI suggests a config — opens the preview panel.
   * The `onConfirm` callback accepts an optional override so the panel
   * can submit a user-edited version of the suggested config.
   */
  onConfigSuggested?: (
    config: AgentConfigData,
    onConfirm: (override?: AgentConfigData) => void,
  ) => void;

  /**
   * Podcast feature — called when the AI suggests a podcast configuration
   * via suggest_podcast_config. The shape is `unknown` here to avoid a
   * hard import on the agent tools file from this UI component; the
   * caller (/podcasts/new client) casts it to SuggestedPodcastConfig.
   */
  onPodcastConfigSuggested?: (config: unknown) => void;

  /** Called when a DB mutation (create/update) starts or finishes */
  onMutatingChange?: (mutating: boolean) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AgentChat({
  mode,
  runId,
  analystId,
  analystName,
  podcastId,
  autoStart,
  headerAction,
  brief = null,
  sources = [],
  theses = [],
  transcript = null,
  currentConfig,
  messages,
  composerSlot,
  principalScope,
  initialPrompt,
  onConfigSuggested,
  onPodcastConfigSuggested,
  onMutatingChange,
}: AgentChatProps) {
  const api = `/api/agent/${mode}`;

  // Model override — meaningful for research-run and principal. Both
  // expose Claude Sonnet 4.6 and GPT-4o via the composer dropdown; the
  // selection persists per-mode in localStorage.
  const supportsModelSwitch = mode === "research-run" || mode === "principal";
  const defaultModel = MODES[mode].model;
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (!supportsModelSwitch) return defaultModel;
    const stored = getStoredModel();
    const valid = RESEARCH_MODEL_OPTIONS.some((o) => o.value === stored);
    return valid ? (stored ?? defaultModel) : defaultModel;
  });

  const handleModelChange = useCallback((value: string) => {
    setSelectedModel(value);
    if (supportsModelSwitch) storeModel(value);
  }, [supportsModelSwitch]);

  const body: Record<string, unknown> = {};
  if (runId) body.runId = runId;
  if (analystId) body.analystId = analystId;
  if (podcastId) body.podcastId = podcastId;
  if (currentConfig) body.currentConfig = currentConfig;
  // Only send override when it differs from the mode default
  if (selectedModel !== defaultModel) body.modelOverride = selectedModel;

  return (
    <ChatRuntime api={api} body={body} messages={messages}>
      <AgentChatInner
        mode={mode}
        analystId={analystId}
        analystName={analystName}
        autoStart={autoStart}
        headerAction={headerAction}
        brief={brief}
        sources={sources}
        theses={theses}
        transcript={transcript}
        currentConfig={currentConfig}
        composerSlot={composerSlot}
        principalScope={principalScope}
        initialPrompt={initialPrompt}
        onConfigSuggested={onConfigSuggested}
        onPodcastConfigSuggested={onPodcastConfigSuggested}
        onMutatingChange={onMutatingChange}
        selectedModel={selectedModel}
        onModelChange={handleModelChange}
      />
    </ChatRuntime>
  );
}

// ── Inner component (inside ChatRuntime — can use thread hooks) ───────────────

interface InnerProps {
  mode: AgentMode;
  analystId?: string;
  analystName?: string;
  autoStart?: boolean;
  headerAction?: ReactNode;
  brief: IntelMorningBrief | null;
  sources: RunSourceItem[];
  theses: ThesisRowData[];
  transcript: TranscriptRowData | null;
  currentConfig?: Record<string, unknown>;
  composerSlot?: ReactNode;
  principalScope?: AgentChatProps["principalScope"];
  initialPrompt?: string;
  onConfigSuggested?: (
    config: AgentConfigData,
    onConfirm: (override?: AgentConfigData) => void,
  ) => void;
  onPodcastConfigSuggested?: (config: unknown) => void;
  onMutatingChange?: (mutating: boolean) => void;
  selectedModel?: string;
  onModelChange?: (value: string) => void;
}

function AgentChatInner({
  mode,
  analystId,
  analystName,
  autoStart,
  headerAction,
  brief,
  sources,
  theses,
  transcript,
  currentConfig,
  composerSlot,
  principalScope,
  initialPrompt,
  onConfigSuggested,
  onPodcastConfigSuggested,
  onMutatingChange,
  selectedModel,
  onModelChange,
}: InnerProps) {
  const router = useRouter();
  const [isMutating, startMutating] = useTransition();

  // research-run: auto-send "Run" to kick off the agent
  useAutoSend({ message: autoStart ? "Run" : initialPrompt, delay: autoStart ? 500 : 300 });

  const handleConfirmConfig = useCallback(
    (config: AgentConfigData) => {
      onMutatingChange?.(true);
      startMutating(async () => {
        try {
          if (mode === "builder") {
            // Session B audit follow-up: builder branch mirrors the editor —
            // industries / themes / marketCap ride through the `universe`
            // payload so createAnalystFromBuilder persists them to the
            // AgentConfig columns. Without this, new analysts start with
            // empty industries/themes even though the Builder proposed them.
            const result = await createAnalystFromBuilder({
              name: config.name ?? "Untitled Analyst",
              analystPrompt: config.analystPrompt ?? "General market research analyst",
              description: config.description,
              directionBias: config.directionBias ?? "BOTH",
              holdDurations: (config.holdDurations ?? ["SWING"]) as ("DAY" | "SWING" | "POSITION")[],
              sectors: config.sectors ?? [],
              signalTypes: config.signalTypes ?? [],
              minConfidence: config.minConfidence ?? 65,
              maxPositionSize: config.maxPositionSize ?? 5000,
              maxOpenPositions: config.maxOpenPositions ?? 5,
              minMarketCapTier: (config.minMarketCapTier ?? "LARGE") as "LARGE" | "MID" | "SMALL",
              watchlist: (config.watchlist ?? []) as string[],
              exclusionList: (config.exclusionList ?? []) as string[],
              domainMonitorProposal: config.domainMonitorProposal,
              intelligenceQueries: config.intelligenceQueries,
              intelligencePolicy: config.intelligencePolicy,
              universe: {
                sectors: config.sectors,
                industries: config.industries,
                themes: config.themes,
                marketCapMin: config.marketCapMin ?? undefined,
                marketCapMax: config.marketCapMax ?? undefined,
              },
            });
            toast.success(`Analyst "${config.name}" created`);
            router.push(`/analysts/${result.id}`);
          } else {
            // Session B: industries/themes/marketCapMin/Max ride through the
            // `universe` payload so they reach AgentConfig columns. Without
            // this, cherry-picking a Universe tab diff would silently no-op
            // because updateAnalystFromBuilder only reads these from `universe`.
            const universeKeys: Array<keyof AgentConfigData> = [
              "sectors",
              "industries",
              "themes",
              "marketCapMin",
              "marketCapMax",
            ];
            const hasUniverseField = universeKeys.some((k) => config[k] !== undefined);
            const universe = hasUniverseField
              ? {
                  sectors: config.sectors,
                  industries: config.industries,
                  themes: config.themes,
                  marketCapMin: config.marketCapMin ?? undefined,
                  marketCapMax: config.marketCapMax ?? undefined,
                }
              : undefined;

            await updateAnalystFromBuilder(analystId!, {
              name: config.name,
              analystPrompt: config.analystPrompt,
              directionBias: config.directionBias as "LONG" | "SHORT" | "BOTH",
              holdDurations: config.holdDurations as ("DAY" | "SWING" | "POSITION")[],
              sectors: config.sectors,
              signalTypes: config.signalTypes,
              minConfidence: config.minConfidence,
              maxPositionSize: config.maxPositionSize,
              maxOpenPositions: config.maxOpenPositions,
              minMarketCapTier: config.minMarketCapTier as "LARGE" | "MID" | "SMALL",
              watchlist: config.watchlist as string[] | undefined,
              exclusionList: config.exclusionList as string[] | undefined,
              domainMonitorProposal: config.domainMonitorProposal,
              intelligenceQueries: config.intelligenceQueries,
              intelligencePolicy: config.intelligencePolicy,
              universe,
            });
            router.push(`/analysts/${analystId}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error(`Failed to ${mode === "builder" ? "create" : "update"} analyst:`, err);
          toast.error(`Failed: ${msg}`);
        } finally {
          onMutatingChange?.(false);
        }
      });
    },
    [mode, analystId, router, onMutatingChange],
  );

  const handleConfigSuggested = useCallback(
    (config: AgentConfigData) => {
      if (onConfigSuggested) {
        onConfigSuggested(config, (override) =>
          handleConfirmConfig(override ?? config),
        );
      }
    },
    [onConfigSuggested, handleConfirmConfig],
  );

  const callbacks = useMemo(
    () => ({
      onConfirmConfig: handleConfirmConfig,
      onConfigSuggested: onConfigSuggested ? handleConfigSuggested : undefined,
      onPodcastConfigSuggested:
        mode === "podcast-builder" || mode === "podcast-editor"
          ? onPodcastConfigSuggested
          : undefined,
      isCreating: isMutating,
      confirmLabel: mode === "builder" ? "Create Analyst" : "Apply Changes",
      confirmingLabel: mode === "builder" ? "Creating..." : "Applying...",
      currentConfig: mode === "editor" ? currentConfig : undefined,
    }),
    [handleConfirmConfig, handleConfigSuggested, onConfigSuggested, onPodcastConfigSuggested, isMutating, mode, currentConfig],
  );

  // ── research-run: tabbed layout ───────────────────────────────────────────

  if (mode === "research-run") {
    const isFollowupMode = !autoStart;
    return (
      <Tabs defaultValue={0} className="flex h-full flex-col">
        <div className="shrink-0 px-4 pt-2 flex items-center">
          <TabsList>
            <TabsTrigger value={0}>Chat</TabsTrigger>
            <TabsTrigger value={1}>Sources</TabsTrigger>
            <TabsTrigger value={2}>Theses</TabsTrigger>
          </TabsList>
          {headerAction && <div className="ml-auto">{headerAction}</div>}
        </div>

        <TabsContent value={0} className="flex-1 min-h-0 flex flex-col">
          <Thread
            welcomeConfig={{
              title: analystName ?? "Research Agent",
              subtitle: isFollowupMode
                ? "Run complete — ask follow-up questions or place trades"
                : "Autonomous research agent",
            }}
            composerSlot={
              composerSlot ?? (
                <HindsightComposer
                  features={{
                    placeholder: isFollowupMode
                      ? "Ask about the run, research a ticker, or place a trade…"
                      : "Ask a follow-up question…",
                    tickerSearch: true,
                    slashCommands: true,
                    modelLabel: RESEARCH_MODEL_OPTIONS.find((o) => o.value === selectedModel)?.label ?? selectedModel ?? "GPT-4o",
                    modelOptions: RESEARCH_MODEL_OPTIONS,
                    onModelChange,
                  }}
                />
              )
            }
          />
        </TabsContent>

        <TabsContent value={1} className="flex-1 min-h-0 overflow-y-auto">
          <RunSourcesPanel brief={brief} sources={sources} />
        </TabsContent>

        <TabsContent value={2} className="flex-1 min-h-0 overflow-y-auto">
          {theses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <p className="text-sm">No theses recorded</p>
              <p className="text-xs mt-1">Theses appear here once the agent records its picks</p>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-2xl px-4 py-6 space-y-2">
              {theses.map((t) => (
                <ThesisRow key={t.id} thesis={t} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    );
  }

  // ── podcast-segment-run: tabbed layout (Chat | Transcript) ──────────────
  // Mirror of the research-run tabbed layout, but Chat | Transcript instead
  // of Chat | Sources | Theses. A segment run produces exactly ONE
  // transcript (vs many theses for analyst runs), so the Transcript tab
  // shows the full TranscriptCard with click-to-expand sheet.
  if (mode === "podcast-segment-run") {
    const isFollowupMode = !autoStart;
    return (
      <Tabs defaultValue={0} className="flex h-full flex-col">
        <div className="shrink-0 px-4 pt-2 flex items-center">
          <TabsList>
            <TabsTrigger value={0}>Chat</TabsTrigger>
            <TabsTrigger value={1}>Transcript</TabsTrigger>
          </TabsList>
          {headerAction && <div className="ml-auto">{headerAction}</div>}
        </div>

        <TabsContent value={0} className="flex-1 min-h-0 flex flex-col">
          <Thread
            welcomeConfig={{
              title: analystName ?? "Segment Run",
              subtitle: isFollowupMode
                ? "Run complete — ask a follow-up about this segment"
                : "Researching this segment and writing the transcript",
            }}
            composerFeatures={PODCAST_SEGMENT_RUN_COMPOSER}
            composerSlot={composerSlot}
          />
        </TabsContent>

        <TabsContent value={1} className="flex-1 min-h-0 overflow-y-auto">
          {transcript ? (
            <div className="mx-auto w-full max-w-2xl px-4 py-6 space-y-2">
              <TranscriptRow transcript={transcript} />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <p className="text-sm">No transcript yet</p>
              <p className="text-xs mt-1">
                The transcript appears here once the agent calls write_segment_transcript.
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    );
  }

  // ── principal: scope picker lives in the Settings2 dropdown; the
  // brand-green-dot chip renders at the top of the input ONLY when an
  // analyst is currently pinned. Unscoped = silent.
  if (mode === "principal") {
    const current = principalScope?.current ?? null;
    const principalComposer: HindsightComposerFeatures = {
      ...PRINCIPAL_COMPOSER,
      placeholder: current
        ? `Ask about ${current.name} — review theses, monitors, runs; place trades…`
        : PRINCIPAL_COMPOSER.placeholder,
      modelLabel:
        RESEARCH_MODEL_OPTIONS.find((o) => o.value === selectedModel)?.label ??
        selectedModel ??
        "Claude Sonnet 4.6",
      modelOptions: RESEARCH_MODEL_OPTIONS,
      onModelChange,
      // Muted, dismissible chip. Standard pill: small dot + analyst name
      // + X to unscope. No styling that competes with the input itself.
      contextChip: current ? (
        <div className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-muted-foreground/70" />
          <span>{current.name}</span>
          <button
            type="button"
            aria-label={`Unscope ${current.name}`}
            onClick={() => principalScope?.onChange(null)}
            className="ml-0.5 -mr-0.5 inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground/70 hover:bg-background hover:text-foreground transition-colors"
          >
            <X className="size-3" />
          </button>
        </div>
      ) : undefined,
      analystScope: principalScope,
    };
    return (
      <Thread
        welcomeConfig={{
          title: current?.name ?? PRINCIPAL_WELCOME.title,
          subtitle: current
            ? `Scoped to ${current.name} — full read + write authority on this analyst.`
            : PRINCIPAL_WELCOME.subtitle,
          icon: PRINCIPAL_WELCOME.icon,
        }}
        composerFeatures={principalComposer}
        composerSlot={composerSlot}
      />
    );
  }

  // ── builder / editor / podcast-builder / podcast-editor: config chat ──────

  const welcomeConfig =
    mode === "builder"
      ? BUILDER_WELCOME
      : mode === "podcast-builder"
        ? PODCAST_BUILDER_WELCOME
        : mode === "podcast-editor"
          ? PODCAST_EDITOR_WELCOME
          : EDITOR_WELCOME;
  const composerFeatures =
    mode === "builder"
      ? BUILDER_COMPOSER
      : mode === "podcast-builder"
        ? PODCAST_BUILDER_COMPOSER
        : mode === "podcast-editor"
          ? PODCAST_EDITOR_COMPOSER
          : EDITOR_COMPOSER;

  return (
    <ToolUICallbacksProvider value={callbacks}>
      <Thread
        welcomeConfig={welcomeConfig}
        composerFeatures={composerFeatures}
        composerSlot={composerSlot}
      />
    </ToolUICallbacksProvider>
  );
}
