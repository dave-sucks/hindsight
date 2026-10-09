"use client";

/**
 * Situations, drawn as a book of dots. Every read, code works out which
 * stocks are in a situation; those light up, and only their situations'
 * instructions travel with the read, once each. The texts and their lengths
 * are the SITUATIONS table, measured on the server; the book is an example.
 */

import { useEffect, useState } from "react";
import type { FrameworkSituation } from "@/lib/docs/framework-content";
import { cn } from "@/lib/utils";
import { Mono } from "../primitives";

const BOOK = 48;

/** Example reads: which stocks (by seat on the grid) are in which situations. */
const READS: ReadonlyArray<{ when: string; flagged: Record<number, string[]> }> = [
  { when: "Monday, 8:00 AM", flagged: { 3: ["REVIEW_DUE"], 17: ["EARNINGS", "PROTECTION"], 30: ["FIRST_RESEARCH"] } },
  { when: "Tuesday, 8:00 AM", flagged: { 17: ["PROTECTIVE_SALE"], 44: ["PLAN_PROBLEM"] } },
  { when: "Wednesday, 8:00 AM", flagged: { 8: ["BUY_ARRIVES"], 21: ["ADD_OR_WINNER"], 26: ["REVIEW_DUE"], 41: ["YOUR_WORD_UNANSWERED"] } },
  { when: "Thursday, 8:00 AM", flagged: { 12: ["STALE_RESEARCH"], 35: ["QUIET_WATCH_WOKE"] } },
];

export function SituationsGrid({ situations }: { situations: readonly FrameworkSituation[] }) {
  const [r, setR] = useState(0);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setR((x) => (x + 1) % READS.length), 3200);
    return () => window.clearInterval(id);
  }, []);

  const read = READS[r];
  const up = new Set(Object.values(read.flagged).flat());
  const byCode = new Map(situations.map((s) => [s.code, s]));
  const sent = [...up].reduce((a, c) => a + (byCode.get(c)?.chars ?? 0), 0);
  const all = situations.reduce((a, s) => a + s.chars, 0);

  return (
    <div className="grid overflow-hidden rounded-2xl border bg-card lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="flex min-w-0 flex-col gap-6 p-5 sm:p-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Mono className="text-xs uppercase tracking-wide text-muted-foreground">{read.when}</Mono>
          <span className="flex gap-1.5">
            {READS.map((x, i) => (
              <button
                key={x.when}
                type="button"
                aria-label={x.when}
                onClick={() => setR(i)}
                className={cn("size-1.5 rounded-full transition-colors", i === r ? "bg-foreground" : "bg-muted-foreground/30")}
              />
            ))}
          </span>
        </div>
        <div className="grid grid-cols-12 gap-x-2 gap-y-3 sm:gap-x-3">
          {Array.from({ length: BOOK }, (_, i) => {
            const codes = read.flagged[i];
            const lit = codes != null;
            const hot = lit && hover != null && codes.includes(hover);
            return (
              <span key={i} className="grid place-items-center">
                <span
                  title={lit ? codes.map((c) => byCode.get(c)?.name ?? c).join(", ") : "quiet: one line"}
                  className={cn(
                    "size-3 rounded-full border transition-all duration-500",
                    lit ? "scale-125 border-blue-500 bg-blue-500" : "border-muted-foreground/40 bg-transparent",
                    hot && "ring-4 ring-blue-500/25",
                  )}
                />
              </span>
            );
          })}
        </div>
        <div className="grid gap-3 border-t pt-5 text-sm sm:grid-cols-3">
          <Stat label="Stocks on the book" value={String(BOOK)} />
          <Stat label="In a situation" value={String(Object.keys(read.flagged).length)} />
          <Stat label="Instructions sent" value={`${sent.toLocaleString("en-US")} chars`} />
        </div>
        <p className="text-sm text-muted-foreground">
          All sixteen texts together are {all.toLocaleString("en-US")} characters. A read carries only the ones a stock on it is in, once each, however many stocks share one. A quiet stock is one line and carries nothing.
        </p>
      </div>

      <ul className="flex flex-col border-t bg-muted/30 p-2 lg:border-l lg:border-t-0">
        {situations.map((s) => {
          const on = up.has(s.code);
          return (
            <li
              key={s.code}
              onMouseEnter={() => setHover(s.code)}
              onMouseLeave={() => setHover(null)}
              className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors", on ? "text-foreground" : "text-muted-foreground/60")}
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", on ? "bg-blue-500" : "bg-muted-foreground/30")} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              <span className="text-xs tabular-nums">{s.chars.toLocaleString("en-US")}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}
