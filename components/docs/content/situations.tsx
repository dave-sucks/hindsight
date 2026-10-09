"use client";

import { useState } from "react";
import { FileText, Flag } from "lucide-react";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";
import { cn } from "@/lib/utils";
import { DocRef, DocSection, P, Ul } from "../doc-text";
import { SituationsGrid } from "../framework/situations-grid";
import { Code, DocBody, DocHeader, Mono, Stage, TechDetails } from "../primitives";

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

/** The table's texts in the shape the situations picture takes, measured here in the browser. */
const GRID = (Object.keys(SITUATIONS) as SituationCode[]).map((code) => ({ code, name: SITUATIONS[code].name, chars: SITUATIONS[code].guidance.length, opening: "" }));

export function SituationsDoc() {
  return (
    <DocBody>
      <DocHeader lead="It knows what needs attention." rest="A stock is in a situation when something about it needs an answer today.">
        There are sixteen, worked out fresh on every read, each with its own instructions for the analyst.
      </DocHeader>

      <Stage>
        <Explorer />
      </Stage>

      <DocSection title="What a situation is">
        <P>
          A situation is a reason a stock needs a decision: a sale fired, a buy level arrived, earnings are close, the research is stale, you said something the
          analyst hasn&apos;t answered. Situations are worked out from the facts every time a stock is read (its <DocRef slug="triggers">triggers</DocRef>,
          the review clock, the research date, the plan against the price, and your words) and never stored.
        </P>
        <Ul>
          <li>
            <strong>Several at once.</strong> A stock can be in more than one. The most urgent leads, and none are hidden behind it.
          </li>
          <li>
            <strong>One answer covers all.</strong> A single save on the stock answers every situation it&apos;s in.
          </li>
          <li>
            <strong>No situation, no work.</strong> A quiet stock is one line in the read and is left alone, so the attention goes where it&apos;s needed.
          </li>
        </Ul>
      </DocSection>

      <DocSection title="The instructions travel with the stock">
        <P>
          What an analyst should do in each situation lives in one table, not in any agent&apos;s prompt. When a stock is in a situation, that
          situation&apos;s instructions arrive with it, once per read, however many stocks share it. A morning with three stocks in two situations carries two
          texts, not the whole table.
        </P>
        <SituationsGrid situations={GRID} />
        <P>
          Each text says when it applies, what to check in order, what the analyst can do, what counts as an answer, and the mistakes to avoid. Changing how
          every agent handles, say, a buy that arrives is one edit to one text.
        </P>
      </DocSection>

      <TechDetails
        rows={[
          { label: "The list", value: <><Code>situationsFor</Code> in <Code>lib/agent/situations.ts</Code>, over the flags from <Code>computeNeedsAction</Code>, today&apos;s lead first.</> },
          { label: "The texts", value: <><Code>SITUATIONS</Code>, the one table of what an agent is told per situation; each text is held under 2,200 characters by test.</> },
          { label: "One feed", value: <><Code>loadWorkInputs</Code> and <Code>loadStockFacts</Code>, shared by the read, the thesis sheet, the quote route and the run close-out.</> },
          { label: "Sent by", value: <><Code>get_theses</Code>, once per read and only for the codes on today&apos;s list; a trigger run reads its stock the same way.</> },
        ]}
      />
    </DocBody>
  );
}
