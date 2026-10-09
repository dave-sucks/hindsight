"use client";

/**
 * ChatMock — a still (or playing) picture of a conversation with an analyst,
 * built from the chat's own parts: the user bubble and message text from
 * components/assistant-ui/thread.tsx, and the tool rows from
 * components/ai-elements/tool-progress.tsx. Nothing here fetches; tickers are
 * drawn the way TickerChip draws them, with the numbers written in.
 *
 * Used by the /docs pages and the signed-out preview beside the sign-in form.
 */

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ArrowUp, MessageCircle, MoreHorizontal, Paperclip, Plus } from "lucide-react";
import {
  ToolProgress,
  ToolProgressContent,
  ToolProgressHeader,
  ToolProgressItem,
  ToolProgressTickerItem,
  type TickerActionIcon,
} from "@/components/ai-elements/tool-progress";
import { Reasoning } from "@/components/agent/Reasoning";
import { SourceChips } from "@/components/assistant-ui/tool-uis/tool-ui-shared";
import type { ToolSource } from "@/lib/agent/tool-result";
import { cn } from "@/lib/utils";
import { Mono } from "./primitives";

export type ChatRow = { ticker?: string; tag?: string; action?: TickerActionIcon; text: ReactNode };

export type ChatStep =
  | { kind: "user"; text: ReactNode }
  | { kind: "text"; text: ReactNode }
  | { kind: "reasoning"; text: string }
  | { kind: "tools"; label: string; rows: readonly ChatRow[]; sources?: ToolSource[] };

/** A ticker the way the chat writes one inline: $SYM, and the day's move when given. */
export function Tk({ s, c }: { s: string; c?: number }) {
  return (
    <span className="mx-0.5 inline-flex items-center gap-1 align-baseline">
      <Mono className="font-medium text-foreground">${s}</Mono>
      {c != null ? (
        <span
          className={cn(
            "inline-flex items-center rounded-md px-1.5 text-xs font-medium tabular-nums",
            c >= 0 ? "bg-positive/10 text-positive" : "bg-negative/10 text-negative",
          )}
        >
          {c >= 0 ? "+" : ""}
          {c.toFixed(2)}%
        </span>
      ) : null}
    </span>
  );
}

/** One step. `live` is the step still arriving: its label shimmers, as in the run page. */
function Step({ step, live = false }: { step: ChatStep; live?: boolean }) {
  if (step.kind === "user") {
    return (
      <div className="flex justify-end py-2 pl-12">
        <div className="rounded-2xl bg-muted px-3.5 py-2 text-message text-foreground">{step.text}</div>
      </div>
    );
  }
  if (step.kind === "text") {
    return <div className="py-1.5 text-message text-foreground">{step.text}</div>;
  }
  if (step.kind === "reasoning") {
    return <Reasoning isStreaming={live}>{step.text}</Reasoning>;
  }
  return (
    <ToolProgress defaultOpen>
      <ToolProgressHeader>
        <span className={cn(live && "shimmer-text")}>{step.label}</span>
      </ToolProgressHeader>
      <ToolProgressContent>
        {step.rows.map((r, i) =>
          r.ticker ? (
            <ToolProgressTickerItem key={i} ticker={r.ticker} tag={r.tag} actionIcon={r.action}>
              {r.text}
            </ToolProgressTickerItem>
          ) : (
            <ToolProgressItem key={i}>{r.text}</ToolProgressItem>
          ),
        )}
        {step.sources?.length ? <SourceChips sources={step.sources} /> : null}
      </ToolProgressContent>
    </ToolProgress>
  );
}

/**
 * Reveals the steps one at a time, like a run streaming in. A tool group shows
 * its header shimmering before its rows land. Holds still for reduced motion.
 */
function usePlayhead(count: number, play: boolean, stepMs: number) {
  const [shown, setShown] = useState(play ? 0 : count);
  useEffect(() => {
    if (!play) return;
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(count);
      return;
    }
    setShown(0);
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= count) window.clearInterval(id);
    }, stepMs);
    return () => window.clearInterval(id);
  }, [count, play, stepMs]);
  return shown;
}

export function ChatMock({
  title,
  steps,
  composer = true,
  play = false,
  stepMs = 1400,
  className,
  bodyClassName,
  bare = false,
}: {
  title: string;
  steps: readonly ChatStep[];
  composer?: boolean;
  /** Stream the steps in one by one. */
  play?: boolean;
  stepMs?: number;
  className?: string;
  bodyClassName?: string;
  /** Just the conversation, the way the run page draws it: no window, no header, no composer. */
  bare?: boolean;
}) {
  const shown = usePlayhead(steps.length, play, stepMs);
  const playing = play && shown < steps.length;
  const body = steps.slice(0, shown).map((s, i) => (
    <div key={i} className={cn(play && "animate-in fade-in-0 slide-in-from-bottom-1 duration-500")}>
      <Step step={s} live={playing && i === shown - 1} />
    </div>
  ));
  if (bare) return <div className={cn("flex min-w-0 flex-col", className)}>{body}</div>;
  return (
    <div className={cn("flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-background shadow-sm", className)}>
      <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm">
        <MessageCircle className="size-4 text-muted-foreground" />
        <span className="truncate font-medium text-foreground">{title}</span>
        <MoreHorizontal className="size-4 text-muted-foreground" />
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Plus className="size-3.5" />
          New chat
        </span>
      </div>
      <div className={cn("flex min-w-0 flex-col px-4 py-3", bodyClassName)}>
        {body}
        {playing ? (
          <div className="flex items-center gap-1.5 py-2" aria-hidden>
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
            <span className="shimmer-text text-sm text-muted-foreground">Working</span>
          </div>
        ) : null}
      </div>
      {composer ? (
        <div className="mt-auto px-3 pb-3">
          <div className="flex items-center gap-2 rounded-2xl border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
            <Paperclip className="size-4" />
            <span className="flex-1">Ask your analyst</span>
            <span className="grid size-7 place-items-center rounded-full bg-foreground text-background">
              <ArrowUp className="size-3.5" />
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Steps written as a list, for pages that only need the tool rows. */
export function ToolRows({ label, rows }: { label: string; rows: readonly ChatRow[] }) {
  return (
    <Fragment>
      <Step step={{ kind: "tools", label, rows }} />
    </Fragment>
  );
}
