"use client";

/**
 * The read, zoomed in: a thesis on the left, the agent on the right. As the
 * agent asks for its book, the sheet is scanned top to bottom; the fields
 * this size of the read carries light up and the rest fade. Three cases: a
 * quiet stock (one line), a stock in a situation (the short row, with that
 * situation's text attached once), and a stock asked for by name (the full
 * row). Which field rides in which size is row-for-model.ts in #816.
 */

import { useEffect, useRef, useState } from "react";
import { Reasoning } from "@/components/agent/Reasoning";
import {
  ToolProgress,
  ToolProgressContent,
  ToolProgressHeader,
  ToolProgressItem,
  ToolProgressTickerItem,
} from "@/components/ai-elements/tool-progress";
import { EXAMPLE_LINE, READ_SIZES, SHEET_FIELDS, type FrameworkSituation, type RowSize } from "@/lib/docs/framework-content";
import { cn } from "@/lib/utils";
import { Mono } from "../primitives";

const CASES: ReadonlyArray<{ size: RowSize; title: string; body: string; ask: string; label: string }> = [
  {
    size: "line",
    title: "A quiet stock",
    body: "Nothing about it changed. One line: the price, the plan, the next review, the score.",
    ask: "Reading the book before the open.",
    label: "Reading your book",
  },
  {
    size: "short",
    title: "A stock in a situation",
    body: "It's near its buy level, so it's listed: the short row, and that situation's instructions, once.",
    ask: "CRWD is close to its buy. What does its plan say?",
    label: "Reading your book",
  },
  {
    size: "full",
    title: "Asked for by name",
    body: "Before buying, the agent wants the whole case: the full row, research and all.",
    ask: "Pulling the full case on CRWD before deciding.",
    label: "Reading $CRWD in full",
  },
];

const FIELDS = SHEET_FIELDS.flatMap((s) => s.fields);
const STEP_MS = 140;

export function ReadDemo({ situation }: { situation?: FrameworkSituation }) {
  const [caseIdx, setCaseIdx] = useState(0);
  const [scan, setScan] = useState(0);
  const sheet = useRef<HTMLDivElement>(null);
  const c = CASES[caseIdx];
  const done = scan >= FIELDS.length;

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setScan(FIELDS.length);
      return;
    }
    setScan(0);
    sheet.current?.scrollTo({ top: 0 });
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setScan(i);
      if (i >= FIELDS.length) window.clearInterval(id);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [caseIdx]);

  // Keep the field being read in view, the way the sheet would scroll.
  useEffect(() => {
    const el = sheet.current?.querySelector<HTMLElement>(`[data-i="${Math.min(scan, FIELDS.length - 1)}"]`);
    const box = sheet.current;
    if (!el || !box) return;
    box.scrollTo({ top: Math.max(0, el.offsetTop - box.clientHeight / 2), behavior: "smooth" });
  }, [scan]);

  const carried = FIELDS.filter((f) => f.sizes.includes(c.size));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2 sm:grid-cols-3">
        {CASES.map((x, i) => (
          <button
            key={x.size}
            type="button"
            onClick={() => setCaseIdx(i)}
            className={cn(
              "flex flex-col gap-1 rounded-xl border p-4 text-left transition-colors",
              i === caseIdx ? "border-foreground/25 bg-card shadow-sm" : "bg-transparent hover:bg-muted/50",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{x.title}</span>
              <Mono className="text-xs text-muted-foreground tabular-nums">{String(i + 1).padStart(2, "0")}</Mono>
            </span>
            <span className="text-sm text-muted-foreground">{x.body}</span>
            <span className={cn("mt-2 h-px overflow-hidden bg-border")}>
              <span
                className="block h-full bg-foreground transition-[width] ease-linear"
                style={{ width: i === caseIdx ? `${(Math.min(scan, FIELDS.length) / FIELDS.length) * 100}%` : "0%", transitionDuration: `${STEP_MS}ms` }}
              />
            </span>
          </button>
        ))}
      </div>

      <div
        className="grid gap-4 rounded-2xl border bg-muted/40 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
      >
        {/* The thesis, as the sheet shows it. */}
        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background shadow-sm">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <span className="grid size-6 place-items-center rounded-md bg-muted text-xs font-semibold text-foreground">C</span>
            <span className="text-sm font-medium text-foreground">CRWD</span>
            <span className="text-sm text-muted-foreground">Thesis</span>
            {c.size === "short" && situation ? (
              <span className="ml-auto rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-500">{situation.name}</span>
            ) : null}
          </div>
          <div ref={sheet} className="relative h-[26rem] overflow-y-auto px-4 py-3 [scrollbar-width:none]">
            {SHEET_FIELDS.map((s) => (
              <div key={s.section} className="flex flex-col gap-1 pb-4">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.section}</p>
                {s.fields.map((f) => {
                  const i = FIELDS.indexOf(f);
                  const seen = i < scan;
                  const reading = i === scan && !done;
                  const read = f.sizes.includes(c.size);
                  return (
                    <div
                      key={f.key}
                      data-i={i}
                      className={cn(
                        "flex flex-col gap-0.5 rounded-lg px-2.5 py-1.5 transition-all duration-300",
                        reading && "bg-foreground/5 ring-1 ring-foreground/20",
                        seen && read && "bg-blue-500/10 ring-1 ring-blue-500/30",
                        seen && !read && "opacity-30",
                      )}
                    >
                      <span className="text-xs text-muted-foreground">{f.label}</span>
                      <span className="text-sm text-foreground">{f.value}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* The agent, receiving it. */}
        <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-background p-4 shadow-sm">
          <Reasoning isStreaming={!done}>{c.ask}</Reasoning>
          <ToolProgress defaultOpen>
            <ToolProgressHeader>
              <span className={cn(!done && "shimmer-text")}>{c.label}</span>
            </ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressTickerItem ticker="CRWD" tag={c.size === "line" ? "Quiet" : c.size === "short" ? "Listed" : "By name"}>
                {c.size === "line" ? "one line" : c.size === "short" ? "the short row" : "the full row"} · {READ_SIZES[c.size]}
              </ToolProgressTickerItem>
              {c.size === "short" && situation ? <ToolProgressItem>Instructions attached once: {situation.name}</ToolProgressItem> : null}
            </ToolProgressContent>
          </ToolProgress>

          <div className={cn("flex min-w-0 flex-col gap-3 pt-2 transition-opacity duration-500", done ? "opacity-100" : "opacity-0")}>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What the model reads</p>
            {c.size === "line" ? (
              <Mono as="pre" className="whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-foreground">
                {EXAMPLE_LINE}
              </Mono>
            ) : (
              <Mono as="pre" className="max-h-56 overflow-hidden whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-foreground [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
                {carried.map((f) => `${f.label.toLowerCase()}: ${f.value}`).join("\n")}
              </Mono>
            )}
            {c.size === "short" && situation ? (
              <div className="flex flex-col gap-1 rounded-lg border border-dashed border-sky-400 bg-sky-400/10 p-3">
                <span className="text-xs font-medium text-foreground">
                  + {situation.name} <span className="text-muted-foreground">· {situation.chars.toLocaleString("en-US")} characters, from the situations table</span>
                </span>
                <span className="text-sm text-muted-foreground">&ldquo;{situation.opening}&rdquo;</span>
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {carried.length} of {FIELDS.length} fields on this sheet.{" "}
              {c.size === "line"
                ? "Everything else waits until something changes."
                : c.size === "short"
                  ? "No research essays: the short row points to the full one by name."
                  : "Two situations get this by rule, because their answer needs the research re-planned."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
