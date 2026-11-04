"use client";

/**
 * The read, zoomed in: a thesis on the left, the agent on the right. Pick
 * one of the seven ways an agent reads a thesis and the fields that read
 * carries light up on the sheet; the rest fade. The sheet is one stack of
 * every field the thesis has, no tabs. Which field rides in which read is
 * lib/docs/framework-content.ts, copied from lib/agent/row-for-model.ts and
 * the writer's prompt; lib/docs/read-cases.test.ts keeps the keys honest.
 */

import { useState } from "react";
import { Reasoning } from "@/components/agent/Reasoning";
import {
  ToolProgress,
  ToolProgressContent,
  ToolProgressHeader,
  ToolProgressItem,
  ToolProgressTickerItem,
} from "@/components/ai-elements/tool-progress";
import { EXAMPLE_LINE, READ_CASES, READ_SIZES, SHEET_FIELDS, fieldsLit, type FrameworkSituation } from "@/lib/docs/framework-content";
import { cn } from "@/lib/utils";
import { Mono } from "../primitives";

export function ReadDemo({ situation }: { situation?: FrameworkSituation }) {
  const [caseIdx, setCaseIdx] = useState(0);
  const c = READ_CASES[caseIdx];
  const lit = fieldsLit(c);
  const carried = SHEET_FIELDS.filter((f) => lit.has(f.id));
  const inSituation = c.size === "short" || c.size === "full";
  const sizeWords =
    c.size === "line" ? `one line · ${READ_SIZES.line}`
    : c.size === "short" ? `the short row · ${READ_SIZES.short}`
    : c.size === "full" ? `the full row · ${READ_SIZES.full}`
    : c.size === "writer" ? "the existing thesis, in the writer's prompt"
    : "nothing on the thesis yet";

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {READ_CASES.map((x, i) => (
          <button
            key={x.id}
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
          </button>
        ))}
      </div>

      <div
        className="grid gap-4 rounded-2xl border bg-muted/40 p-3 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
        style={{ backgroundImage: "radial-gradient(var(--border) 1px, transparent 1.3px)", backgroundSize: "18px 18px" }}
      >
        {/* The thesis, as the sheet shows it: one stack, every field. */}
        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-background shadow-sm">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <span className="grid size-6 place-items-center rounded-md bg-muted text-xs font-semibold text-foreground">C</span>
            <span className="text-sm font-medium text-foreground">CRWD</span>
            <span className="text-sm text-muted-foreground">Thesis</span>
            <span className="ml-auto text-xs text-muted-foreground tabular-nums">
              {carried.length} of {SHEET_FIELDS.length} fields
            </span>
          </div>
          <div className="h-[26rem] overflow-y-auto px-4 py-3 [scrollbar-width:none]">
            <div className="flex flex-col gap-1">
              {SHEET_FIELDS.map((f) => {
                const on = lit.has(f.id);
                return (
                  <div
                    key={f.id}
                    data-lit={on ? "true" : undefined}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-lg px-2.5 py-1.5",
                      on ? "bg-blue-500/10 ring-1 ring-blue-500/30" : "opacity-40",
                    )}
                  >
                    <span className="text-xs text-muted-foreground">{f.label}</span>
                    <span className="line-clamp-2 text-sm text-foreground">{f.value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* The agent, receiving it. */}
        <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-background p-4 shadow-sm">
          <Reasoning isStreaming={false}>{c.ask}</Reasoning>
          <ToolProgress defaultOpen>
            <ToolProgressHeader>{c.label}</ToolProgressHeader>
            <ToolProgressContent>
              <ToolProgressTickerItem ticker="CRWD" tag={c.tag}>{sizeWords}</ToolProgressTickerItem>
              {inSituation && situation ? <ToolProgressItem>Instructions attached once: {situation.name}</ToolProgressItem> : null}
            </ToolProgressContent>
          </ToolProgress>

          <div className="flex min-w-0 flex-col gap-3 pt-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">What the model reads</p>
            {c.size === "line" ? (
              <Mono as="pre" className="whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-foreground">
                {EXAMPLE_LINE}
              </Mono>
            ) : carried.length === 0 ? (
              <p className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">Nothing. The thesis does not exist yet; the writer&apos;s output is its first version.</p>
            ) : (
              <Mono as="pre" className="max-h-56 overflow-hidden whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 text-xs leading-relaxed text-foreground [mask-image:linear-gradient(to_bottom,black_70%,transparent)]">
                {carried.map((f) => `${f.label.toLowerCase()}: ${f.value}`).join("\n")}
              </Mono>
            )}
            {inSituation && situation ? (
              <div className="flex flex-col gap-1 rounded-lg border border-dashed border-sky-400 bg-sky-400/10 p-3">
                <span className="text-xs font-medium text-foreground">
                  + {situation.name} <span className="text-muted-foreground">· {situation.chars.toLocaleString("en-US")} characters, from the situations table</span>
                </span>
                <span className="text-sm text-muted-foreground">&ldquo;{situation.opening}&rdquo;</span>
              </div>
            ) : null}
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <p><span className="font-medium text-foreground">When.</span> {c.when}</p>
              <p><span className="font-medium text-foreground">How.</span> {c.how}</p>
              <p><span className="font-medium text-foreground">Why.</span> {c.why}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
