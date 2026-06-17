/**
 * digest-writer.ts — the narration writer for the Daily Portfolio Digest
 * (Feature A). See docs/plans/PORTFOLIO_DIGEST.md.
 *
 * Input: the deterministic facts blob ONLY (lib/portfolio/digest-facts.ts).
 * Output: 4-6 short markdown paragraphs with inline reference tokens. The
 * writer narrates + judges; it NEVER invents a number — every figure it prints
 * comes from the facts. The facts blob carries the ids the tokens need.
 *
 * Reference tokens (the only structure in the prose):
 *   [MU](thesis:<thesisId>)            — a ticker → opens its thesis
 *   [Momentum Breakout](analyst:<id>)  — an analyst → /analysts/[id]
 *   [tactical 18:46](run:<runId>)      — a run → /runs/[id]
 *
 * Model: a cheap chat model (GPT-4o), invoked the same way the other
 * lib/inngest callers do (OpenAI SDK chat.completions), so this file works
 * without the AI SDK streaming machinery.
 */

import OpenAI from "openai";
import type { DigestFacts } from "@/lib/portfolio/digest-facts";

const DIGEST_MODEL = "gpt-4o";

export interface DigestWriterResult {
  narrative: string;
  model: string;
}

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" });
}

const SYSTEM_PROMPT = `You write the Daily Portfolio Digest for an AI-run paper/real trading account.
You are writing for two readers: the principal (a human reviewing the book) and the agents themselves (run-to-run memory). Be sharp, concrete, and opinionated — but every number and name you use MUST come from the FACTS provided. Never invent a figure, ticker, price, or analyst.

OUTPUT: 4-6 SHORT markdown paragraphs. No headings, no bullet lists, no tables. Prose only.

INLINE REFERENCE TOKENS — use these exact markdown-link forms so the UI can render them:
- A ticker: [TICKER](thesis:THESIS_ID) — use the thesisId from facts. Use this EVERY time you name a ticker that has a thesisId.
- An analyst: [Analyst Name](analyst:ANALYST_ID) — when attributing a decision/run.
- A run: [short label](run:RUN_ID) — e.g. [tactical 14:32](run:RUN_ID) — when pointing at a specific run.
Tokens degrade to plain text if unrendered, so write them inline naturally. Do NOT use a token if the corresponding id is null/missing — just use plain text.

WHAT TO COVER (in roughly this order):
1. Portfolio-level state: equity, day P&L and total P&L (deposit-adjusted — these are pure trading P&L, not inflated by deposits), how deployed the book is (slots used vs capacity, idle cash).
2. The daily-vs-tactical-vs-discovery split: what each run type did today.
3. Today's decisions and trades: entries, exits, trims, adds, reviews, passes — attribute to analyst/run where it adds traceability.
4. The agent-memory timeline: how passes and entries have aged. For HELD names, narrate per-name moves using the NOW price + "since entry" %% and "today" %% from facts ("MU is +12% since entry, +1.2% today"). For PASSES, use the verdict + "since pass" move from facts: a MISSED pass is regret (the name ran without us — quote the % it ran), a DODGED pass was the right call (quote the drop avoided). Name the worst MISSES explicitly.
5. A short forward read: is the book fully deployed, idle, over-concentrated, or has stale cadence?

JUDGMENT (from facts only): say things like "book is fully deployed," "two passes are running without us," "no new entry in N days — cadence is cold," "concentration is heavy in <sector>." Do not soften with hedges. Do not fabricate.

If a day was quiet (no runs, no trades), say so plainly in 1-2 short paragraphs. Do not pad.`;

/** Compact a number to a $ string the model can quote verbatim. */
function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/**
 * Render the facts blob into a compact, token-ready prompt. We hand the model
 * pre-formatted figures + the ids inline so it doesn't have to do math or guess
 * an id — it just narrates.
 */
export function buildDigestPrompt(facts: DigestFacts): string {
  const lines: string[] = [];

  lines.push(`DATE: ${facts.date}`);
  lines.push(
    `PNL (deposit-adjusted): day ${money(facts.pnl.dayPnl)} (${pct(facts.pnl.dayPnlPct)}), ` +
      `total ${money(facts.pnl.totalPnl)} (${pct(facts.pnl.totalPnlPct)}), ` +
      `realized today ${money(facts.pnl.realizedToday)}, ` +
      `net contributed ${money(facts.pnl.netContributed)}.` +
      (facts.hadAlpaca ? "" : " [NOTE: no broker data — P&L is best-effort.]"),
  );

  const b = facts.book;
  lines.push(
    `BOOK: equity ${money(b.totalEquity)}, cash ${money(b.cash)}, buying power ${money(b.buyingPower)}, ` +
      `gross exposure ${money(b.grossExposure)} (long ${money(b.longMarketValue)}, short ${money(b.shortMarketValue)}). ` +
      `Slots used ${b.slotsUsedLabel}.` +
      (b.topSector && b.topSectorConcentration != null
        ? ` Top sector ${b.topSector} = ${(b.topSectorConcentration * 100).toFixed(0)}% of gross.`
        : ""),
  );

  const c = facts.cadence;
  lines.push(
    `CADENCE: fully deployed=${c.fullyDeployed}, idle cash ${money(c.idleCash)}, ` +
      `days since last new entry=${c.daysSinceLastNewEntry ?? "n/a"}, pending proposals=${c.pendingProposals}.`,
  );

  const rr = facts.runRollup;
  lines.push(
    `RUNS TODAY: ${rr.daily} daily, ${rr.tactical} tactical, ${rr.discovery} discovery (${rr.failed} failed).`,
  );
  if (facts.runs.length) {
    lines.push("RUN DETAIL:");
    for (const r of facts.runs) {
      const who = r.analystName
        ? r.analystId
          ? `[${r.analystName}](analyst:${r.analystId})`
          : r.analystName
        : "unknown analyst";
      const label = `${labelMode(r.mode)} ${r.startedAtEt}`;
      lines.push(`  - [${label}](run:${r.runId}) — ${who} — status ${r.status}`);
    }
  }

  if (b.held.length) {
    lines.push("HELD POSITIONS:");
    for (const h of b.held) {
      const tk = h.thesisId ? `[${h.ticker}](thesis:${h.thesisId})` : h.ticker;
      // "MU LONG 10 @ $100.00, NOW $112.50 (+12.50% since entry, +1.20% today) (Momentum)"
      const moveParts: string[] = [];
      if (h.sinceEntryPct != null)
        moveParts.push(`${pct(h.sinceEntryPct)} since entry`);
      if (h.dayChangePct != null)
        moveParts.push(`${pct(h.dayChangePct)} today`);
      const now =
        h.currentPrice != null
          ? `, NOW ${money(h.currentPrice)}` +
            (moveParts.length ? ` (${moveParts.join(", ")})` : "")
          : "";
      lines.push(
        `  - ${tk} ${h.direction} ${h.quantity} @ ${money(h.avgCost)}${now}` +
          (h.analystName ? ` (${h.analystName})` : ""),
      );
    }
  }

  if (facts.trades.length) {
    lines.push("TRADES TODAY:");
    for (const t of facts.trades) {
      const parts = [`${t.kind} ${t.ticker}`];
      if (t.quantity != null) parts.push(`qty ${t.quantity}`);
      if (t.price != null) parts.push(`@ ${money(t.price)}`);
      if (t.realizedPnl != null) parts.push(`realized ${money(t.realizedPnl)}`);
      if (t.analystName) parts.push(`(${t.analystName})`);
      lines.push(`  - ${t.timeEt} ${parts.join(" ")}`);
    }
  }

  if (facts.decisions.length) {
    lines.push("DECISIONS TODAY (thesis updates):");
    for (const d of facts.decisions) {
      const tk = `[${d.ticker}](thesis:${d.thesisId})`;
      const who = d.analystName ? ` (${d.analystName})` : "";
      lines.push(`  - ${d.timeEt} ${d.type} ${tk}${who}: ${d.summary}`);
    }
  }

  if (facts.passesAged.length) {
    lines.push("PASSES AGED (regret signal — names we declined; DODGED = pass was right, MISSED = regret):");
    for (const p of facts.passesAged) {
      const tk = `[${p.ticker}](thesis:${p.thesisId})`;
      // "MU passed 5d ago at $100.00, NOW $112.50 (+12.50%) — MISSED"
      const at = p.priceAtPass != null ? ` at ${money(p.priceAtPass)}` : "";
      const now =
        p.currentPrice != null
          ? `, NOW ${money(p.currentPrice)}` +
            (p.sincePassPct != null ? ` (${pct(p.sincePassPct)})` : "")
          : "";
      const verdict = p.verdict !== "FLAT" ? ` — ${p.verdict}` : "";
      lines.push(`  - ${tk} passed ${p.daysSincePass}d ago${at}${now}${verdict}`);
    }
  }

  return lines.join("\n");
}

function labelMode(mode: string): string {
  switch (mode) {
    case "MORNING_PLAN":
      return "daily";
    case "INTRADAY_TACTICAL":
      return "tactical";
    case "DISCOVERY":
      return "discovery";
    default:
      return mode.toLowerCase();
  }
}

/**
 * Generate the digest narrative from the facts blob. Falls back to a terse
 * deterministic summary if the model call fails, so the cron always writes
 * SOMETHING (the facts blob is still the source of truth).
 */
export async function writeDigestNarrative(
  facts: DigestFacts,
): Promise<DigestWriterResult> {
  const prompt = buildDigestPrompt(facts);

  try {
    const resp = await getOpenAI().chat.completions.create({
      model: DIGEST_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `FACTS:\n${prompt}` },
      ],
      temperature: 0.4,
      max_tokens: 900,
    });
    const text = resp.choices[0]?.message?.content?.trim() ?? "";
    if (text) return { narrative: text, model: DIGEST_MODEL };
  } catch (err) {
    console.warn(
      `[digest-writer] model call failed: ${err instanceof Error ? err.message : err}`,
    );
  }

  return { narrative: fallbackNarrative(facts), model: "fallback" };
}

/** Deterministic, no-LLM narrative used when the model call fails. */
export function fallbackNarrative(facts: DigestFacts): string {
  const rr = facts.runRollup;
  const lines: string[] = [];
  lines.push(
    `Book equity ${money(facts.book.totalEquity)}; day ${money(facts.pnl.dayPnl)} (${pct(facts.pnl.dayPnlPct)}), ` +
      `total ${money(facts.pnl.totalPnl)} (${pct(facts.pnl.totalPnlPct)}, deposit-adjusted). ` +
      `Slots used ${facts.book.slotsUsedLabel}, idle cash ${money(facts.cadence.idleCash)}.`,
  );
  lines.push(
    `Runs: ${rr.daily} daily, ${rr.tactical} tactical, ${rr.discovery} discovery (${rr.failed} failed). ` +
      `${facts.trades.length} trade action(s), ${facts.decisions.length} thesis decision(s) today.`,
  );
  if (facts.passesAged.length) {
    const missed = facts.passesAged.filter((p) => p.verdict === "MISSED");
    const dodged = facts.passesAged.filter((p) => p.verdict === "DODGED");
    const missLabel = missed.length
      ? ` ${missed.length} running without us (` +
        missed
          .slice(0, 3)
          .map(
            (p) =>
              `${p.ticker}${p.sincePassPct != null ? ` ${pct(p.sincePassPct)}` : ""}`,
          )
          .join(", ") +
        ")."
      : "";
    lines.push(
      `${facts.passesAged.length} recent pass(es) tracked: ${missed.length} missed, ${dodged.length} dodged.${missLabel}`,
    );
  }
  return lines.join("\n\n");
}
