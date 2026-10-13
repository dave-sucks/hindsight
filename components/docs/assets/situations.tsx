"use client";

import { useState } from "react";
import { FileText, Flag } from "lucide-react";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";
import { cn } from "@/lib/utils";
import { SituationsGrid } from "../framework/situations-grid";
import { Mono, Stage } from "../primitives";

const CODES = Object.keys(SITUATIONS) as SituationCode[];

function capital(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Explorer() {
  const [code, setCode] = useState<SituationCode>("PROTECTIVE_SALE");
  const s = SITUATIONS[code];
  return (
    <div className="grid overflow-hidden rounded-2xl border bg-background shadow-sm md:grid-cols-[15rem_minmax(0,1fr)]">
      <div className="flex max-h-none gap-1 overflow-x-auto border-b p-2 md:max-h-[34rem] md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
        {CODES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCode(c)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
              c === code ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Flag className="size-3.5 shrink-0" />
            {capital(SITUATIONS[c].name)}
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium text-foreground">{capital(s.name)}</p>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <FileText className="size-3.5" />
            What the analyst reads
          </p>
          <Mono as="pre" className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border bg-muted/40 p-4 text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">
            {s.guidance}
          </Mono>
        </div>
      </div>
    </div>
  );
}

/** The table's texts in the shape the situations picture takes, measured here in the browser. */
const GRID = (Object.keys(SITUATIONS) as SituationCode[]).map((code) => ({ code, name: SITUATIONS[code].name, chars: SITUATIONS[code].guidance.length, opening: "" }));

/** Every situation, one at a time: what it means and the text the analyst reads. */
export function SituationExplorer() {
  return (
    <Stage>
      <Explorer />
    </Stage>
  );
}

/** The sixteen texts, drawn at their sizes. */
export function SituationSizes() {
  return <SituationsGrid situations={GRID} />;
}
