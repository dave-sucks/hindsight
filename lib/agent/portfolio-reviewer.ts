/**
 * portfolio-reviewer.ts — the Portfolio Reviewer: the 8 PM ET run that reads
 * the day's facts, gathered by code (lib/portfolio/digest-facts.ts), and
 * writes two things:
 *   - the PORTFOLIO BRIEF, for every agent: 3 to 5 sentences, 700 characters
 *     at most, read in the Market and portfolio block (PortfolioDigest.brief).
 *     Only what an account-level view sees and one stock's run can't; it never
 *     repeats the numbers the block already gives;
 *   - the PORTFOLIO DIGEST, for the owner's digest card: the sales waiting
 *     first, then today's recap (PortfolioDigest.narrative), with inline
 *     reference tokens the card turns into links:
 *       [MU](thesis:<thesisId>) · [Momentum Breakout](analyst:<id>) · [tactical 18:46](run:<runId>)
 *
 * The model writes words; every number comes from the facts. Cash is the
 * broker's cash and nothing else: the facts' margin buying power is never
 * shown to it, and it never tells anyone to put idle cash to work.
 *
 * Each review is a ResearchRun (mode PORTFOLIO_REVIEW) whose thread holds the
 * facts as its first message and the reply after it, so it opens like any
 * other run (lib/inngest/functions/portfolio-digest.ts). Each model call keeps
 * what it sent on that run (lib/agent/run-requests.ts).
 */
import { generateText, type LanguageModelUsage, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import type { DigestFacts } from "@/lib/portfolio/digest-facts";
import { BRIEF_MAX_CHARS, capBrief } from "@/lib/agent/market-and-portfolio";
import { saleHistory, type WaitingSale } from "@/lib/portfolio/sale-queue";
import { dayLabel } from "@/lib/market-data/market-calendar";
import { recordRequests } from "@/lib/agent/run-requests";

export const PORTFOLIO_REVIEWER = {
  name: "Portfolio Reviewer",
  /** ResearchRun.mode. */
  mode: "PORTFOLIO_REVIEW",
  model: "gpt-5.4",
  /** The reply, and one more when the brief or the digest is missing or the brief is too long. */
  maxSteps: 2,
} as const;

/** A proposal waiting for approval, as the reviewer's facts list it. */
export interface PendingProposalFact {
  ticker: string;
  side: string;
  intent: string | null;
  quantity: number;
  analystName: string | null;
}

export const REVIEWER_PROMPT = `You are the Portfolio Reviewer for an AI-run trading account. Every weekday at 8 PM ET you read the day's facts, gathered by code, and write two things: a brief that every analyst agent reads before it decides on a stock, and a digest the owner reads.

Every number and name you use comes from the FACTS. Never invent a figure, a ticker, a price or an analyst.

Cash is the account's cash, and there is no other money. Never suggest putting idle cash to work, filling empty slots or deploying more of the account: cash is not a problem to fix, and a quiet day is not a failure.

Reply in exactly this form, with these two headings and nothing before the first:

## Brief
3 to 5 sentences, ${BRIEF_MAX_CHARS} characters at most, in plain words with no links. Every analyst agent reads it beside the account's numbers, so never repeat a number (the value, the day's change, the cash, the holdings, the sales waiting). Say only what a view of the whole account sees and one stock's run can't: a theme getting crowded across holdings, sales piling up against the analysts' own notes, how much of the account rides on one story. Name the stocks.

## Digest
For the owner: short markdown paragraphs, no headings, no lists, in this order.
1. The sales waiting, first: one short paragraph per sale, written as the owner's decision. Say what the floor is and where the price is now, and how many times the sale has been proposed and since when. Then what the analyst's note says, and the owner's choices by what it says:
   - It argues to hold and names a price to hold at: approve the sale, or lower the floor to that price.
   - It argues to hold and names no price to hold at: approve the sale, or lower the floor yourself; the analyst names no level.
   - It agrees with the sale: say the analyst agrees. The choices are approve the sale, or keep it waiting, and it is proposed again tomorrow; if you would rather hold, lowering the floor is yours to set, and the analyst names no level for it.
   A price the note gives for something else (a price to buy back at, a price that would change its mind, the floor itself) is never a floor to lower to, and neither is a price at or above tonight's: a floor there sells again at once. Report the analyst's view and the choices: recommend nothing yourself, and never say hold or sell as your own advice.
2. Today's recap: the account's value and the day's change. Say the account closed at a value only when the VALUE line gives it at the close.
3. Each holding's move, today and since entry.
4. Any other proposals waiting, and what everything waiting adds up to.
5. The open question: the one thing today left unsettled.
6. Tomorrow's priority.
In the digest only, write a ticker that has a thesis id as [TICKER](thesis:THESIS_ID), an analyst as [Name](analyst:ANALYST_ID) and a run as [label](run:RUN_ID), and only with an id the facts give.

If nothing happened today, say so in a few short sentences. Do not pad.`;

function money(n: number): string {
  const abs = Math.abs(n);
  return `${n < 0 ? "-" : ""}$${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
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

const PROPOSAL_WORD: Record<string, string> = { CLOSE: "sell", PARTIAL_CLOSE: "trim", OPEN: "buy", ADD: "add" };

/** "9:35 AM ET on Tue Nov 10". */
function firedWhen(iso: string): string {
  const d = new Date(iso);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...o }).format(d);
  return `${f({ hour: "numeric", minute: "2-digit" })} ET on ${f({ weekday: "short" })} ${f({ month: "short" })} ${f({ day: "numeric" })}`;
}

/**
 * The facts as the reviewer reads them: pre-formatted figures with the ids
 * inline, so it never does math or guesses an id. No buying power, no
 * "idle cash", no slots to fill: those read as orders to buy.
 */
export function buildReviewerInput(facts: DigestFacts, pending: readonly PendingProposalFact[], sales: readonly WaitingSale[] = []): string {
  const lines: string[] = [];
  const b = facts.book;

  lines.push(`DATE: ${facts.date}`);
  // Where the value was read: at a close, in the session, or (when a holding had no price) at the broker's marks.
  const valueAt =
    b.closeOf === undefined
      ? ""
      : b.closeOf
        ? ` at the ${dayLabel(b.closeOf)} close`
        : ` at ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(new Date(facts.generatedAtIso))} ET, ${b.marketOpen ? "in the session" : "not a close"}`;
  lines.push(
    `VALUE${valueAt}: ${money(b.totalEquity)}; ${facts.pnl.dayUnknown ? "the day's change couldn't be worked out" : `${b.closeOf ? "on the day" : "today"} ${money(facts.pnl.dayPnl)} (${pct(facts.pnl.dayPnlPct)})`}, ` +
      `since the start ${money(facts.pnl.totalPnl)} (${pct(facts.pnl.totalPnlPct)}), both net of deposits; realized today ${money(facts.pnl.realizedToday)}.` +
      (facts.hadAlpaca ? "" : " [No broker data: the figures are best-effort.]"),
  );
  lines.push(
    `CASH: ${money(b.cash)}` + (b.totalEquity > 0 ? ` (${((b.cash / b.totalEquity) * 100).toFixed(1)}% of the account)` : "") + ".",
  );
  lines.push(
    `HOLDINGS: ${b.heldCount}, long ${money(b.longMarketValue)}` +
      (b.shortMarketValue > 0 ? `, short ${money(b.shortMarketValue)}` : "") +
      (b.topSector && b.topSectorConcentration != null ? `; the biggest sector is ${b.topSector}, ${(b.topSectorConcentration * 100).toFixed(0)}% of what we hold` : "") +
      ".",
  );

  const rr = facts.runRollup;
  lines.push(`RUNS TODAY: ${rr.daily} daily, ${rr.tactical} tactical, ${rr.discovery} discovery (${rr.failed} failed).`);
  if (facts.runs.length) {
    lines.push("RUN DETAIL:");
    for (const r of facts.runs) {
      const who = r.analystName ? (r.analystId ? `[${r.analystName}](analyst:${r.analystId})` : r.analystName) : "unknown analyst";
      lines.push(`  - [${labelMode(r.mode)} ${r.startedAtEt}](run:${r.runId}) — ${who} — status ${r.status}`);
    }
  }

  if (b.held.length) {
    lines.push("HELD POSITIONS:");
    for (const h of b.held) {
      const tk = h.thesisId ? `[${h.ticker}](thesis:${h.thesisId})` : h.ticker;
      const moves = [h.sinceEntryPct != null ? `${pct(h.sinceEntryPct)} since entry` : null, h.dayChangePct != null ? `${pct(h.dayChangePct)} today` : null].filter(Boolean);
      const now = h.currentPrice != null ? `, NOW ${money(h.currentPrice)}${moves.length ? ` (${moves.join(", ")})` : ""}` : "";
      lines.push(`  - ${tk} ${h.direction} ${h.quantity} @ ${money(h.avgCost)}${now}${h.analystName ? ` (${h.analystName})` : ""}`);
    }
  }

  if (pending.length) {
    const priceOf = new Map(b.held.map((h) => [h.ticker, h.currentPrice]));
    let total = 0;
    let priced = true;
    const valued = pending.map((p) => {
      const price = priceOf.get(p.ticker) ?? null;
      const value = price != null ? price * p.quantity : null;
      if (value == null) priced = false;
      else total += value;
      return { p, price, value };
    });
    const line = (p: PendingProposalFact, price: number | null, value: number | null) =>
      `  - ${PROPOSAL_WORD[p.intent ?? ""] ?? (p.side === "SELL" ? "sell" : "buy")} ${p.ticker} ${p.quantity} sh${p.analystName ? ` (${p.analystName})` : ""}` +
      (value != null ? `, about ${money(value)} at tonight's price of ${money(price!)}` : "");
    const sells = valued.filter((v) => v.p.side === "SELL");
    if (sells.length) {
      lines.push(
        "SALES WAITING FOR THE OWNER'S DECISION (oldest first). A crossed floor proposes its sale again every trading day until the owner approves it or lowers the floor; only the owner can lower a floor.",
      );
      for (const { p, price, value } of sells) {
        // A sale or trim carries its history and, from code, the floor that fired and the note in full.
        const s = sales.find((x) => x.ticker === p.ticker && (x.kind === "trim") === (p.intent === "PARTIAL_CLOSE"));
        const d = s?.decision;
        lines.push(`${line(p, price, value)}.`);
        if (d?.floor) {
          const under = d.level != null && price != null ? ` Tonight's price is ${(Math.abs(price / d.level - 1) * 100).toFixed(1)}% ${price < d.level ? "under" : "over"} it.` : "";
          lines.push(`    The floor that fired: "${d.floor}", at ${firedWhen(d.firedAt)}${d.firedPrice != null ? ` at ${money(d.firedPrice)}` : ""}.${under}`);
        } else if (d) lines.push("    The floor that fired: no fire was found before this proposal.");
        if (s) lines.push(`    ${saleHistory(s).replace(/^p/, "P")}.`);
        if (d) lines.push(d.note ? `    Its note today, in full:\n${d.note.split("\n").map((l) => `      ${l}`).join("\n")}` : "    Its note today: none was written.");
      }
    }
    const others = valued.filter((v) => v.p.side !== "SELL");
    if (others.length) {
      lines.push("OTHER PROPOSALS WAITING FOR APPROVAL:");
      for (const { p, price, value } of others) lines.push(line(p, price, value));
    }
    lines.push(`ALL PROPOSALS WAITING: ${pending.length}, ${priced ? "" : "at least "}about ${money(total)} at tonight's prices.`);
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
      lines.push(`  - ${d.timeEt} ${d.type} [${d.ticker}](thesis:${d.thesisId})${d.analystName ? ` (${d.analystName})` : ""}: ${d.summary}`);
    }
  }

  if (facts.passesAged.length) {
    lines.push("PASSES AGED (stocks we declined; DODGED = the pass was right, MISSED = it ran without us):");
    for (const p of facts.passesAged) {
      const at = p.priceAtPass != null ? ` at ${money(p.priceAtPass)}` : "";
      const now = p.currentPrice != null ? `, NOW ${money(p.currentPrice)}${p.sincePassPct != null ? ` (${pct(p.sincePassPct)})` : ""}` : "";
      lines.push(`  - [${p.ticker}](thesis:${p.thesisId}) passed ${p.daysSincePass}d ago${at}${now}${p.verdict !== "FLAT" ? ` — ${p.verdict}` : ""}`);
    }
  }

  return lines.join("\n");
}

/** The reply's two parts. A problem names what the one retry asks the model to fix. */
export function parseReview(text: string): { brief: string | null; digest: string | null; problems: string[] } {
  const m = text.match(/^##\s*Brief\s*\n([\s\S]*?)^##\s*Digest\s*\n([\s\S]*)$/im);
  const brief = m?.[1]?.replace(/\[([^\]]+)\]\((?:thesis|run|analyst):[^)\s]*\)/g, "$1").replace(/\s+/g, " ").trim() || null;
  const digest = m?.[2]?.trim() || null;
  const problems: string[] = [];
  if (!m) problems.push('The reply needs the two headings, "## Brief" and then "## Digest".');
  else {
    if (!brief) problems.push("The brief is empty.");
    else if (brief.length > BRIEF_MAX_CHARS) problems.push(`The brief is ${brief.length} characters; the most is ${BRIEF_MAX_CHARS}.`);
    if (!digest) problems.push("The digest is empty.");
  }
  return { brief, digest, problems };
}

const amount = (s: string) => Number(s.replace(/,/g, ""));
const sameLevel = (a: number, b: number) => Math.abs(a - b) < 0.005;

/**
 * Each floor price the digest offers that the analyst's note doesn't back,
 * as a problem for the one retry: the owner would read it as the analyst's
 * level. Code can tell three cases: a price the note never names, the floor
 * itself, and a price at or above tonight's (a floor there sells again at once).
 */
export function floorOfferProblems(digest: string, sales: readonly WaitingSale[], priceOf: (ticker: string) => number | null): string[] {
  return floorOffers(digest, sales, priceOf).map((o) => o.problem);
}

/** "lower the floor to $X", "lower its floor to around $X", "set the floor at $X", "move your floor to $X". */
const FLOOR_OFFER = /\b(?:lower(?:ing)?|set(?:ting)?|mov(?:e|ing)) (?:the|its|your|that) floor (?:to|at) (?:around |about |roughly |near |approximately )?\$(\d[\d,]*(?:\.\d+)?)/gi;

function floorOffers(digest: string, sales: readonly WaitingSale[], priceOf: (ticker: string) => number | null): Array<{ paragraph: number; sale: WaitingSale; problem: string }> {
  const out: Array<{ paragraph: number; sale: WaitingSale; problem: string }> = [];
  digest.split(/\n\s*\n/).forEach((para, paragraph) => {
    // The paragraph's sale: the first waiting ticker it names.
    const sale = sales
      .map((s) => ({ s, at: para.search(new RegExp(`\\b${s.ticker}\\b`)) }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => a.at - b.at)[0]?.s;
    if (!sale) return;
    const price = priceOf(sale.ticker);
    const named = [...(sale.decision?.note ?? "").matchAll(/\$(\d[\d,]*(?:\.\d+)?)/g)].map((m) => amount(m[1]));
    for (const offer of para.matchAll(FLOOR_OFFER)) {
      const level = amount(offer[1]);
      const why =
        sale.decision?.level != null && sameLevel(level, sale.decision.level)
          ? "which is the floor itself"
          : price != null && level >= price
            ? `which is at or above tonight's price of $${price}, so the floor would sell again at once`
            : !named.some((n) => sameLevel(n, level))
              ? "which the analyst's note doesn't name"
              : null;
      if (why) out.push({ paragraph, sale, problem: `On ${sale.ticker} the digest offers to lower the floor to $${offer[1]}, ${why}. Offer a floor price only when the note argues to hold and names that price, below tonight's.` });
    }
  });
  return out;
}

/**
 * The digest with each paragraph that still offers such a price replaced by
 * code's own: the sale's history and the choices that name no level. No
 * unbacked level reaches the owner, whichever reply the digest came from.
 */
export function withoutUnbackedFloors(digest: string, sales: readonly WaitingSale[], priceOf: (ticker: string) => number | null): string {
  const bad = new Map(floorOffers(digest, sales, priceOf).map((o) => [o.paragraph, o.sale]));
  if (!bad.size) return digest;
  return digest
    .split(/\n\s*\n/)
    .map((para, i) => {
      const sale = bad.get(i);
      return sale ? `On ${sale.ticker}: ${saleHistory(sale)}. Your choices: approve the sale, or lower the floor yourself; the analyst names no level.` : para;
    })
    .join("\n\n");
}

export interface PortfolioReview {
  brief: string | null;
  narrative: string;
  model: string;
  /** The thread: the facts as the first message, then the model's messages. */
  opening: ModelMessage[];
  messages: ModelMessage[];
  usage: LanguageModelUsage[];
}

/** One model call. `call` names it on the run page ("Main", "Retry"); with a run id, what it sent is kept on that run. */
type Generate = (args: { system: string; messages: ModelMessage[]; call: string; runId?: string | null }) => Promise<{ text: string; responseMessages: ModelMessage[]; usage: LanguageModelUsage }>;

const generate: Generate = async ({ system, messages, call, runId }) => {
  const sent = recordRequests(runId, call, "portfolio-reviewer");
  const res = await sent.around(generateText({ model: openai.chat(PORTFOLIO_REVIEWER.model), system, messages, abortSignal: AbortSignal.timeout(180_000), onStepFinish: (step) => sent.step(step) }));
  return { text: res.text, responseMessages: res.response.messages as ModelMessage[], usage: res.usage };
};

/**
 * Write the brief and the digest. One retry when the reply is missing a part,
 * the brief runs long or the digest offers a floor price the note doesn't
 * back; after that a long brief is cut at its last full sentence that fits,
 * and a sale's paragraph that still offers such a price is code's own. If the model fails, the digest is the plain facts
 * (fallbackNarrative) and there is no brief.
 */
export async function writePortfolioReview(
  facts: DigestFacts,
  pending: readonly PendingProposalFact[],
  deps: { generate?: Generate; sales?: readonly WaitingSale[]; runId?: string | null } = {},
): Promise<PortfolioReview> {
  const run = deps.generate ?? generate;
  const sales = deps.sales ?? [];
  const opening: ModelMessage[] = [{ role: "user", content: `FACTS:\n${buildReviewerInput(facts, pending, sales)}` }];
  const messages: ModelMessage[] = [];
  const usage: LanguageModelUsage[] = [];
  const tonight = new Map(facts.book.held.map((h) => [h.ticker.toUpperCase(), h.currentPrice]));
  const check = (p: ReturnType<typeof parseReview>) => [...p.problems, ...(p.digest ? floorOfferProblems(p.digest, sales, (t) => tonight.get(t) ?? null) : [])];
  try {
    let reply = await run({ system: REVIEWER_PROMPT, messages: opening, call: "Main", runId: deps.runId });
    messages.push(...reply.responseMessages);
    usage.push(reply.usage);
    let parsed = parseReview(reply.text);
    const problems = check(parsed);
    if (problems.length) {
      const ask: ModelMessage = { role: "user", content: `${problems.join(" ")} Reply again in the same form, with both parts.` };
      reply = await run({ system: REVIEWER_PROMPT, messages: [...opening, ...messages, ask], call: "Retry", runId: deps.runId });
      messages.push(ask, ...reply.responseMessages);
      usage.push(reply.usage);
      const again = parseReview(reply.text);
      parsed = { brief: again.brief ?? parsed.brief, digest: again.digest ?? parsed.digest, problems: again.problems };
      const left = check(parsed);
      if (left.length) console.warn(`[portfolio-reviewer] after the retry, code writes these sales' choices: ${left.join(" ")}`);
    }
    // Whichever reply the digest is from, a floor price the note doesn't back never reaches the owner.
    const text = parsed.digest ?? reply.text.trim();
    const narrative = text ? withoutUnbackedFloors(text, sales, (t) => tonight.get(t) ?? null) : fallbackNarrative(facts);
    return { brief: parsed.brief ? capBrief(parsed.brief) : null, narrative, model: PORTFOLIO_REVIEWER.model, opening, messages, usage };
  } catch (err) {
    console.warn(`[portfolio-reviewer] the model call failed: ${err instanceof Error ? err.message : err}`);
    return { brief: null, narrative: fallbackNarrative(facts), model: "fallback", opening, messages, usage };
  }
}

/** The plain facts, used as the digest when the model call fails. No brief is written from it. */
export function fallbackNarrative(facts: DigestFacts): string {
  const rr = facts.runRollup;
  const lines: string[] = [];
  lines.push(
    `Account value ${money(facts.book.totalEquity)}; ${facts.pnl.dayUnknown ? "the day's change couldn't be worked out" : `today ${money(facts.pnl.dayPnl)} (${pct(facts.pnl.dayPnlPct)})`}, ` +
      `since the start ${money(facts.pnl.totalPnl)} (${pct(facts.pnl.totalPnlPct)}, net of deposits). Cash ${money(facts.book.cash)}.`,
  );
  lines.push(
    `Runs: ${rr.daily} daily, ${rr.tactical} tactical, ${rr.discovery} discovery (${rr.failed} failed). ` +
      `${facts.trades.length} trade action(s), ${facts.decisions.length} thesis decision(s) today.`,
  );
  if (facts.passesAged.length) {
    const missed = facts.passesAged.filter((p) => p.verdict === "MISSED");
    const dodged = facts.passesAged.filter((p) => p.verdict === "DODGED");
    lines.push(`${facts.passesAged.length} recent pass(es) tracked: ${missed.length} missed, ${dodged.length} dodged.`);
  }
  return lines.join("\n\n");
}
