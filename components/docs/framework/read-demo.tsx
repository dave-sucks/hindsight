"use client";

/**
 * The read, field by field. The left side is a thesis compressed into one
 * stack: every field the sheet has after 2026-11-04, one or two lines each.
 * The right side picks one of the seven ways an agent reads a thesis; the
 * fields that read sends light up blue, the rest stay as they are. No tabs
 * on the sheet, no animation. Which field rides in which read is
 * lib/docs/framework-content.ts, copied from lib/agent/row-for-model.ts and
 * the writer's prompt; lib/docs/read-cases.test.ts keeps the keys honest.
 */

import { useState } from "react";
import { ChipTabs } from "@/components/ui/chip-tabs";
import { READ_CASES, SHEET_FIELDS, fieldsLit, type FrameworkSituation } from "@/lib/docs/framework-content";
import { cn } from "@/lib/utils";
import { Mono } from "../primitives";

const OPTIONS = READ_CASES.map((c, i) => ({ value: c.id, label: `${i + 1}. ${c.title}` }));

export function ReadDemo({ situation: _situation }: { situation?: FrameworkSituation }) {
  const [caseId, setCaseId] = useState<string>(READ_CASES[0].id);
  const read = READ_CASES.find((c) => c.id === caseId) ?? READ_CASES[0];
  const lit = fieldsLit(read);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
      {/* The sheet, as one stack. */}
      <div className="rounded-xl border p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-sm font-medium">CRWD · CrowdStrike</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {lit.size} of {SHEET_FIELDS.length} fields sent
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          {SHEET_FIELDS.map((f) => {
            const on = lit.has(f.id);
            return (
              <div
                key={f.id}
                data-lit={on ? "true" : undefined}
                className={cn(
                  "rounded-lg border px-3 py-2 transition-colors",
                  on ? "border-blue-500/60 bg-blue-500/10 shadow-[0_0_18px_-6px] shadow-blue-500/60" : "border-transparent",
                )}
              >
                <p className={cn("text-xs font-medium uppercase tracking-wide", on ? "text-blue-500" : "text-muted-foreground")}>{f.label}</p>
                <p className={cn("line-clamp-2 text-sm leading-relaxed", on ? "text-foreground" : "text-muted-foreground")}>{f.value}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* The seven reads. */}
      <div className="flex flex-col gap-4">
        <ChipTabs options={OPTIONS} value={caseId} onChange={(v) => { if (v) setCaseId(v); }} clearable={false} />
        <div className="rounded-xl border p-4 sm:p-5 space-y-4">
          <p className="text-lg font-medium">{read.title}</p>
          <Row label="When">{read.when}</Row>
          <Row label="How">{read.how}</Row>
          <Row label="Why">{read.why}</Row>
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Keys on the row</p>
            {read.keys.length > 0 ? (
              <Mono className="block text-xs leading-relaxed text-muted-foreground break-words">{read.keys.join(" · ")}</Mono>
            ) : (
              <p className="text-sm text-muted-foreground">None. Nothing on the thesis exists yet.</p>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          The fields and the keys come from lib/agent/row-for-model.ts and the writer&apos;s prompt. A field no read lights stays on the sheet and never reaches a model.
        </p>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm leading-relaxed">{children}</p>
    </div>
  );
}
