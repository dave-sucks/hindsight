"use client";

/**
 * Principal Chat — operator co-pilot.
 *
 * Scope header: "Portfolio" (no analyst pinned) or "@AnalystName"
 * (URL-scoped via ?analyst=<id>). Clicking the chip opens a picker
 * that navigates to /chat?analyst=<id> or /chat for portfolio.
 *
 * Model: defaults to Claude Sonnet 4.6 (the user's preferred deep-work
 * model). The in-chat composer model dropdown can flip to GPT-4o.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { UIMessage } from "ai";
import { Thread } from "@/components/assistant-ui/thread";
import { HindsightComposer } from "@/components/assistant-ui/hindsight-composer";
import { ChatRuntime } from "@/components/chat/chat-runtime";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bot, ChevronDown, Wallet, MessageCircle } from "lucide-react";
import { RESEARCH_MODEL_OPTIONS } from "@/lib/agent/modes";

const MODEL_PREF_KEY = "hindsight_principal_model";
const DEFAULT_MODEL = "claude-sonnet-4-6";

function getStoredModel(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(MODEL_PREF_KEY);
}

function storeModel(value: string) {
  localStorage.setItem(MODEL_PREF_KEY, value);
}

interface Props {
  runId?: string;
  scopedAnalyst: { id: string; name: string } | null;
  analysts: Array<{ id: string; name: string; enabled: boolean }>;
  initialMessages: UIMessage[];
}

export function ChatPageClient({
  runId,
  scopedAnalyst,
  analysts,
  initialMessages,
}: Props) {
  const router = useRouter();
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    const stored = getStoredModel();
    const valid = RESEARCH_MODEL_OPTIONS.some((o) => o.value === stored);
    return valid ? (stored ?? DEFAULT_MODEL) : DEFAULT_MODEL;
  });

  const handleModelChange = useCallback((value: string) => {
    setSelectedModel(value);
    storeModel(value);
  }, []);

  // Body carries scope + session id so the route can resume the right
  // PRINCIPAL_CHAT ResearchRun (when scoped) and wire write-tool FKs.
  const body: Record<string, unknown> = {};
  if (runId) body.runId = runId;
  if (scopedAnalyst) body.analystId = scopedAnalyst.id;
  if (selectedModel !== DEFAULT_MODEL) body.modelOverride = selectedModel;

  const handlePickScope = useCallback(
    (analystId: string | null) => {
      // Navigate so the server component re-runs and resumes/creates
      // the right session row.
      router.push(analystId ? `/chat?analyst=${analystId}` : "/chat");
    },
    [router],
  );

  const subtitle = scopedAnalyst
    ? `Scoped to ${scopedAnalyst.name}. Full read + write authority on this analyst.`
    : "Portfolio scope — read across every analyst. Pick a scope to enable trades + thesis edits.";

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      {/* Scope header */}
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm">
                {scopedAnalyst ? (
                  <>
                    <Bot className="h-3.5 w-3.5" />
                    {scopedAnalyst.name}
                  </>
                ) : (
                  <>
                    <Wallet className="h-3.5 w-3.5" />
                    Portfolio
                  </>
                )}
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuItem onClick={() => handlePickScope(null)}>
              <Wallet className="h-3.5 w-3.5" />
              Portfolio (no analyst pinned)
            </DropdownMenuItem>
            {analysts.length > 0 && <DropdownMenuSeparator />}
            {analysts.map((a) => (
              <DropdownMenuItem
                key={a.id}
                onClick={() => handlePickScope(a.id)}
              >
                <Bot className="h-3.5 w-3.5" />
                {a.name}
                {!a.enabled && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    disabled
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-xs text-muted-foreground">
          {scopedAnalyst
            ? "Trades, thesis edits, and watchlist changes apply to this analyst."
            : "Read-only across analysts. Pick an analyst to unlock writes."}
        </span>
      </div>

      <ChatRuntime
        api="/api/agent/principal"
        body={body}
        messages={initialMessages}
      >
        <Thread
          welcomeConfig={{
            title: scopedAnalyst
              ? `Chat — ${scopedAnalyst.name}`
              : "Hindsight",
            subtitle,
            icon: (
              <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MessageCircle className="size-5" />
              </div>
            ),
          }}
          composerSlot={
            <HindsightComposer
              features={{
                tickerSearch: true,
                slashCommands: true,
                placeholder: scopedAnalyst
                  ? `Ask about ${scopedAnalyst.name} — review theses, monitors, runs; place trades…`
                  : "Ask about your portfolio, an analyst, a ticker, or a thesis…",
                modelLabel:
                  RESEARCH_MODEL_OPTIONS.find((o) => o.value === selectedModel)
                    ?.label ?? selectedModel,
                modelOptions: RESEARCH_MODEL_OPTIONS,
                onModelChange: handleModelChange,
              }}
            />
          }
        />
      </ChatRuntime>
    </div>
  );
}
