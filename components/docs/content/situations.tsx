"use client";

import { useState } from "react";
import { FileText, Flag } from "lucide-react";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";
import { cn } from "@/lib/utils";
import { Code, DocBody, DocHeader, Mono, Section, Stage, TechDetails, Trio } from "../primitives";

/** Each situation in a sentence for people. The text the analyst reads is SITUATIONS' own. */
const PLAIN: Record<SituationCode, string> = {
  PROMOTED_AWAITING: "A stock just moved from paper to live money and needs a decision this run.",
  PROTECTIVE_SALE: "A floor, a trail or a trim fired on a holding, or a sale you declined is still past its line.",
  BUY_ARRIVES: "A watched stock reached its buy level.",
  BUY_BLOCKED_FULL: "A buy fired while the analyst already holds all it may.",
  ADD_OR_WINNER: "An add level fired, or a holding is three quarters of the way to its target.",
  EARNINGS: "A report is close, or just landed with a beat or a miss.",
  FILING: "The company filed something that matters with the SEC.",
  QUIET_WATCH_WOKE: "A watch with no plan woke up and needs a fresh look.",
  PROTECTION: "A gain with no floor under it, or a floor too far below the price.",
  FIRST_RESEARCH: "A new stock on the watchlist is due its first research.",
  REVIEW_DUE: "The review clock came round and nothing else is going on.",
  STALE_RESEARCH: "The research is older than the analyst's limit.",
  PLAN_PROBLEM: "The plan contradicts the tape: a buy level left behind, a target passed, a floor too tight.",
  YOUR_WORD_UNANSWERED: "You left a note or made a decision since the analyst's last answer.",
  SOLD_ONE_REVIEW: "A stock sold recently is owed one look back.",
  NO_SETUP_NAMED: "A researched stock has no setup named, so nothing says how to trade it.",
};

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
          <p className="text-sm text-muted-foreground">{PLAIN[code]}</p>
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

export function SituationsDoc() {
  return (
    <DocBody>
      <DocHeader
        eyebrow="Concept"
        lead="It knows what needs attention."
        rest="A stock is in a situation when something about it needs an answer today. Sixteen of them, worked out fresh on every read, each with its own guidance for the analyst."
      />

      <Stage>
        <Explorer />
      </Stage>

      <Trio
        items={[
          { title: "Several at once", body: "A stock can be in more than one situation. The most urgent leads, and none are hidden behind it." },
          { title: "Guidance travels with the stock", body: "Each situation's instructions arrive with the stock that needs them, once per read. None of it lives in a prompt." },
          { title: "Worked out, never stored", body: "Situations are read from the facts each time: the triggers, the clock, the research date, the plan, your words." },
        ]}
      />

      <Section eyebrow="Quiet stocks" lead="No situation, no work." rest="A stock with nothing going on gets a short entry in the analyst's read and is left alone, so the attention goes where it's needed.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">A quiet stock</p>
            <Mono as="code" className="text-xs text-foreground">ADBE · watch · LONG · PEAD · $398.20 · buy $402 · target $452 · floor $379</Mono>
          </div>
          <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">A stock with a situation</p>
            <p className="text-sm text-foreground">Its position, the plan, every trigger as a sentence, the belief and what would break it, what&apos;s been said, the chart, and the guidance for each situation it&apos;s in.</p>
          </div>
        </div>
      </Section>

      <TechDetails
        rows={[
          { label: "The list", value: <><Code>situationsFor</Code> in <Code>lib/agent/situations.ts</Code>, over the flags from <Code>computeNeedsAction</Code>, today&apos;s lead first.</> },
          { label: "The texts", value: <><Code>SITUATIONS</Code>, the one table of what an agent is told per situation; each text is held under 2,200 characters by test.</> },
          { label: "One feed", value: <><Code>loadWorkInputs</Code> and <Code>loadStockFacts</Code>, shared by the read, the thesis sheet, the quote route and the run close-out.</> },
          { label: "Sent by", value: <><Code>get_theses</Code> (once per read, only the codes on today&apos;s list) and the trigger run&apos;s prompt.</> },
        ]}
      />
    </DocBody>
  );
}
