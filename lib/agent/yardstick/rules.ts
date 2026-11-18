/**
 * The yardstick's rules for the agents that write for the owner (the
 * Portfolio Manager, the Market Reviewer, the portfolio digest): each one is
 * a sentence of the agent's current instructions, quoted with its file, and
 * the check that reads a replayed run against it (docs/plans/AGENT_ENGINE.md,
 * "The yardstick"). A rule exists only where a sentence says it: when the
 * owner changes that sentence, rules.test.ts fails until the rule changes
 * with it. Pure functions over the run's calls and text and what it was sent.
 */
import type { AgentId } from "@/lib/agent/engine/types";
import { dollarsIn, inventedNumbers, stockPricesIn, type GradedCall } from "./grade";

/** A sentence of an agent's instructions, and the file it is written in. */
export interface Quote {
  agent: AgentId;
  file: string;
  quote: string;
}

/** One replayed run, as the rules read it. */
export interface RuleRun {
  calls: GradedCall[];
  /** Its reply: the Portfolio Manager's write-up, the digest's prose, the Market Reviewer's digest. */
  reply: string;
  /** The Market Reviewer's notes. */
  notes?: Array<{ tickers: string[]; text: string; impact: string; effect: string }>;
  /** Everything it was sent: the instructions, the first message, the conversation. */
  shown: string;
  /** The portfolio snapshot it was sent. */
  portfolio: string | null;
  /** The market numbers it was sent. */
  marketNumbers?: string | null;
  /** Every stock held or watched, as it was sent (the Market Reviewer's book). */
  book?: string[];
  /** Thesis id to ticker, from the rows it read. */
  thesisTickers?: Map<string, string>;
}

export interface Rule extends Quote {
  id: string;
  /** What the rule found wrong, one line each; none when the run kept it. */
  check: (run: RuleRun) => string[];
}

export interface Broken {
  rule: string;
  problem: string;
}

const PM_FILE = "lib/agent/engine/agents/portfolio-manager.ts";
const REVIEWER_FILE = "lib/agent/engine/agents/market-reviewer.ts";
const DIGEST_FILE = "lib/agent/engine/agents/portfolio-digest.ts";

// ── Reading what it was sent ────────────────────────────────────────────────

/** The holdings a portfolio snapshot lists. */
export function holdingsOf(portfolio: string | null): string[] {
  const out: string[] = [];
  let on = false;
  for (const line of (portfolio ?? "").split("\n")) {
    if (/^Holdings \(\d+\)/.test(line)) { on = true; continue; }
    if (on && !line.startsWith("- ")) break;
    const m = on ? line.match(/^- ([A-Z][A-Z.\-]*):/) : null;
    if (m) out.push(m[1]);
  }
  return out;
}

/** The proposals a portfolio snapshot lists as waiting for the owner. */
export function waitingOf(portfolio: string | null): Array<{ side: "BUY" | "SELL"; ticker: string }> {
  const out: Array<{ side: "BUY" | "SELL"; ticker: string }> = [];
  let on = false;
  for (const line of (portfolio ?? "").split("\n")) {
    if (line.startsWith("Waiting for the owner's approval")) { on = true; continue; }
    if (on && !line.startsWith("- ")) break;
    const m = on ? line.match(/^- (Buy|Sell) [\d,.]+ shares? of ([A-Z][A-Z.\-]*)/) : null;
    if (m) out.push({ side: m[1] === "Buy" ? "BUY" : "SELL", ticker: m[2] });
  }
  return out;
}

/** The text under each `### ` heading of a reply, by heading, in order. */
export function sectionsOf(reply: string): Array<{ heading: string; body: string }> {
  const out: Array<{ heading: string; body: string }> = [];
  for (const chunk of reply.split(/^(?=### )/m)) {
    const m = chunk.match(/^### (.+)\n?([\s\S]*)$/);
    if (m) out.push({ heading: m[1].replace(/\*/g, "").trim(), body: m[2].trim() });
  }
  return out;
}

/** The headings missing or out of order, against the ones asked for. */
function headingProblems(reply: string, want: string[]): string[] {
  const got = sectionsOf(reply).map((s) => s.heading.toLowerCase());
  const missing = want.filter((h) => !got.includes(h.toLowerCase()));
  if (missing.length) return [`no "### ${missing.join('", "### ')}"`];
  const order = want.map((h) => got.indexOf(h.toLowerCase()));
  return order.every((at, i) => i === 0 || at > order[i - 1]) ? [] : [`the headings are out of order: ${got.join(" / ")}`];
}

/** A text's sentences; a link written just after a sentence's full stop ("… fell. ([AP](…))") stays with that sentence. */
const sentences = (text: string) =>
  text
    .split(/(?<=[.!?])\s+(?=[A-Z"“(\[])|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .reduce<string[]>((out, s) => (/^\(?\[[^\]]*\]\(https?:/.test(s) && out.length ? [...out.slice(0, -1), `${out[out.length - 1]} ${s}`] : [...out, s]), []);
const named = (text: string, ticker: string) => new RegExp(`(^|[^A-Za-z])\\$?${ticker.replace(".", "\\.")}(?![A-Za-z])`).test(text);
const LINK = /\]\(https?:\/\/[^)]+\)|https?:\/\/\S+/;

/** A text with its links' addresses taken out: what the owner reads. */
export const withoutLinks = (text: string) => text.replace(/\]\((https?:\/\/[^)]+)\)/g, "]").replace(/https?:\/\/\S+/g, "");

/**
 * Words written in capitals that aren't stocks: what the market and the economy
 * are called, so a check on stock names passes them.
 */
const NOT_STOCKS = new Set(
  "A I AI US USA UK EU ET PM AM CEO CFO CTO COO IPO ETF ETFS EPS GDP CPI PPI PCE FOMC FED SEC FDA FTC DOJ IRS NYSE NASDAQ OPEC VIX HBM GPU GPUS CPU DRAM NAND LLM API SAAS Q1 Q2 Q3 Q4 YOY QOQ FY P&L ESG M&A EV EVS LNG OK II III IV NA S&P DC MW GW TW NOTE NO".split(" "),
);

/** Words in capitals, two to five letters, that read as tickers. */
const tickersIn = (text: string) => [...new Set((withoutLinks(text).match(/\b[A-Z]{2,5}\b/g) ?? []).filter((t) => !NOT_STOCKS.has(t)))];

/** Of those, the ones written as a stock: "$XYZ", "(XYZ)", "XYZ's", "XYZ shares", "XYZ fell". News prose is full of other capitals (AP, PPA). */
const stocksNamedIn = (text: string) => {
  const plain = withoutLinks(text);
  return tickersIn(plain).filter((t) => new RegExp(`\\$${t}\\b|\\(${t}\\)|\\b${t}(?:['’]s\\b|\\s+(?:shares|stock|fell|rose|jumped|dropped|slid|gained|climbed|sank|rallied|slipped|surged|is|was|has)\\b)`).test(plain));
};

/** A trade's stock and side. */
function tradeOf(c: GradedCall): { ticker: string; side: "BUY" | "SELL" } | null {
  const a = (c.input ?? {}) as Record<string, unknown>;
  if (c.toolName === "place_trade") return { ticker: String(a.ticker ?? "").toUpperCase(), side: "BUY" };
  if (c.toolName === "close_position") return { ticker: String(a.ticker ?? "").toUpperCase(), side: "SELL" };
  if (c.toolName === "manage_position") return { ticker: String(a.symbol ?? "").toUpperCase(), side: a.action === "add_to_position" ? "BUY" : "SELL" };
  return null;
}

// ── The rules ───────────────────────────────────────────────────────────────

export const RULES: Rule[] = [
  // The Portfolio Manager.
  {
    id: "pm.three",
    agent: "portfolio_manager",
    file: PM_FILE,
    quote: "At most 3 proposals a run; the tools refuse a fourth.",
    check: (r) => {
      const n = r.calls.filter((c) => tradeOf(c)).length;
      return n > 3 ? [`${n} proposals`] : [];
    },
  },
  {
    id: "pm.note_with_trade",
    agent: "portfolio_manager",
    file: PM_FILE,
    quote: "Right after each, write your note on that stock with update_thesis: the note is what the owner reads on the proposal, so argue the trade in it and name its reason.",
    check: (r) => {
      const out: string[] = [];
      r.calls.forEach((c, i) => {
        const t = tradeOf(c);
        if (!t) return;
        const noted = r.calls.slice(i + 1).some((n) => n.toolName === "update_thesis" && r.thesisTickers?.get(String((n.input as Record<string, unknown>)?.thesis_id ?? "")) === t.ticker);
        if (!noted) out.push(`no note on ${t.ticker} after its proposal`);
      });
      return out;
    },
  },
  {
    id: "pm.note_only_with_trade",
    agent: "portfolio_manager",
    file: PM_FILE,
    quote: "You write a note only on a stock you proposed a trade on or sent to research this run; the tool refuses any other.",
    check: (r) => {
      const traded = new Set(r.calls.map(tradeOf).filter(Boolean).map((t) => t!.ticker));
      const researched = new Set(r.calls.filter((c) => c.toolName === "dispatch_thesis_research").map((c) => String((c.input as Record<string, unknown>)?.existing_thesis_id ?? "")));
      return r.calls
        .filter((c) => c.toolName === "update_thesis")
        .map((c) => String((c.input as Record<string, unknown>)?.thesis_id ?? ""))
        .filter((id) => !researched.has(id) && !traded.has(r.thesisTickers?.get(id) ?? ""))
        .map((id) => `a note on ${r.thesisTickers?.get(id) ?? id}, which it neither traded nor sent to research`);
    },
  },
  {
    id: "pm.waiting",
    agent: "portfolio_manager",
    file: PM_FILE,
    quote: "A proposal already waiting for the owner is theirs to answer: don't propose that trade again.",
    check: (r) => {
      const waiting = waitingOf(r.portfolio);
      return r.calls
        .map(tradeOf)
        .filter((t): t is NonNullable<typeof t> => t != null && waiting.some((w) => w.ticker === t.ticker && w.side === t.side))
        .map((t) => `proposed the ${t.side === "BUY" ? "buy" : "sale"} of ${t.ticker} already waiting`);
    },
  },
  {
    id: "pm.stock_data",
    agent: "portfolio_manager",
    file: PM_FILE,
    quote: "Use get_stock_data only on a stock you are about to trade.",
    check: (r) => {
      const traded = new Set(r.calls.map(tradeOf).filter(Boolean).map((t) => t!.ticker));
      return r.calls
        .filter((c) => c.toolName === "get_stock_data")
        .map((c) => String((c.input as Record<string, unknown>)?.ticker ?? "").toUpperCase())
        .filter((t) => !traded.has(t))
        .map((t) => `get_stock_data on ${t}, which it didn't trade`);
    },
  },
  {
    id: "pm.writeup_headings",
    agent: "portfolio_manager",
    file: PM_FILE,
    quote: 'Under these "### " headings, in this order:',
    check: (r) => headingProblems(r.reply, ["Where the money is", "The ranking", "What I did", "Open questions", "What the account needs"]),
  },
  {
    id: "pm.ranking",
    agent: "portfolio_manager",
    file: PM_FILE,
    quote: "**The ranking**: what you'd most want to own today down to what you'd least, holdings and the best of the watches together, a clause of why for each.",
    check: (r) => {
      const ranking = sectionsOf(r.reply).find((s) => /^the ranking/i.test(s.heading));
      if (!ranking) return [];
      const left = holdingsOf(r.portfolio).filter((t) => !named(ranking.body, t));
      return left.length ? [`the ranking leaves out ${left.join(", ")}`] : [];
    },
  },
  {
    id: "pm.what_i_did",
    agent: "portfolio_manager",
    file: PM_FILE,
    quote: '**What I did**: each proposal and note from this run, and why. "Nothing" when nothing.',
    check: (r) => {
      const did = sectionsOf(r.reply).find((s) => /^what i did/i.test(s.heading));
      if (!did) return [];
      const acted = new Set<string>();
      for (const c of r.calls) {
        const t = tradeOf(c);
        if (t) acted.add(t.ticker);
        const id = String((c.input as Record<string, unknown>)?.thesis_id ?? (c.input as Record<string, unknown>)?.existing_thesis_id ?? "");
        if ((c.toolName === "update_thesis" || c.toolName === "dispatch_thesis_research") && r.thesisTickers?.get(id)) acted.add(r.thesisTickers.get(id)!);
      }
      if (acted.size === 0) return /\bnothing\b/i.test(did.body) ? [] : ['did nothing and "What I did" doesn\'t say "Nothing"'];
      const left = [...acted].filter((t) => !named(did.body, t));
      return left.length ? [`"What I did" leaves out ${left.join(", ")}`] : [];
    },
  },

  // The Market Reviewer.
  {
    id: "reviewer.sections",
    agent: "market_reviewer",
    file: REVIEWER_FILE,
    quote: 'Six sections, each under its own "### " heading, in this order: Market overview, Sector developments, Major developments, Implications for your portfolio, What deserves attention, Upcoming events.',
    check: (r) => headingProblems(r.reply, ["Market overview", "Sector developments", "Major developments", "Implications for your portfolio", "What deserves attention", "Upcoming events"]),
  },
  {
    id: "reviewer.only_sections",
    agent: "market_reviewer",
    file: REVIEWER_FILE,
    quote: "Write only the six sections: nothing before the first heading or after the last section.",
    check: (r) => {
      const before = r.reply.split(/^### /m)[0].trim();
      return before ? [`text before the first heading: "${before.slice(0, 80)}"`] : [];
    },
  },
  {
    id: "reviewer.length",
    agent: "market_reviewer",
    file: REVIEWER_FILE,
    // "About" is read as half to one and a half times: the rule flags a digest outside that.
    quote: "About 3,000 characters in all, the links not counted.",
    check: (r) => {
      const n = withoutLinks(r.reply).length;
      return n < 1_500 || n > 4_500 ? [`${n.toLocaleString("en-US")} characters, links not counted (flagged outside 1,500 to 4,500)`] : [];
    },
  },
  {
    id: "reviewer.market_numbers",
    agent: "market_reviewer",
    file: REVIEWER_FILE,
    quote: "The Market numbers in your first message are the index, sector and earnings numbers to use: search the web for what moved them, not for the numbers.",
    check: (r) => {
      const block = r.marketNumbers ?? "";
      const given = (block.match(/[−-]?\d+(?:\.\d+)?%/g) ?? []).map((p) => Math.abs(Number(p.replace(/[−%]/g, "").replace("-", ""))));
      const names = [...new Set([...(block.match(/\b(?:SPY|QQQ|VIXY|XL[A-Z]{1,2})\b/g) ?? []), ...(/S&P 500/.test(block) ? ["S&P 500"] : []), ...(/Nasdaq 100/.test(block) ? ["Nasdaq 100"] : [])])];
      // An index's percent is the first one within 40 characters after its name ("the S&P 500 fell 1.01%").
      const out: string[] = [];
      for (const s of sentences(withoutLinks(r.reply))) {
        for (const n of names) {
          for (let at = s.indexOf(n); at >= 0; at = s.indexOf(n, at + n.length)) {
            const p = s.slice(at + n.length, at + n.length + 40).match(/\d+(?:\.\d+)?%/)?.[0];
            if (p && !given.some((g) => Math.abs(g - Number(p.replace("%", ""))) <= 0.1)) out.push(`${n} ${p}, not its first message's: "${s.slice(0, 100)}"`);
          }
        }
      }
      return [...new Set(out)];
    },
  },
  {
    id: "reviewer.waiting",
    agent: "market_reviewer",
    file: REVIEWER_FILE,
    quote: 'A proposal under "Waiting for the owner\'s approval" is the owner\'s call: say nothing for or against one, its timing or its size, in the digest or in a note.',
    check: (r) => {
      const waiting = waitingOf(r.portfolio).map((w) => w.ticker);
      const texts = [r.reply, ...(r.notes ?? []).map((n) => n.text)];
      const out: string[] = [];
      for (const s of texts.flatMap((t) => sentences(withoutLinks(t)))) {
        const on = waiting.filter((t) => named(s, t));
        if (on.length && /\b(approv\w*|declin\w*|proposals?|proposed|pending|awaiting|the (?:sale|buy|trim|order)|timing|sizing|size of)\b/i.test(s)) out.push(`on the waiting ${on.join(", ")}: "${s.slice(0, 120)}"`);
      }
      return out;
    },
  },
  {
    id: "reviewer.book_only",
    agent: "market_reviewer",
    file: REVIEWER_FILE,
    quote: "Name only stocks in the book when you write about the portfolio.",
    check: (r) => {
      const section = sectionsOf(r.reply).find((s) => /^implications for your portfolio/i.test(s.heading));
      if (!section) return [];
      const ok = new Set([...(r.book ?? []), ...tickersIn(r.marketNumbers ?? "")]);
      const left = stocksNamedIn(section.body).filter((t) => !ok.has(t));
      return left.length ? [`names ${left.join(", ")}, not in the book`] : [];
    },
  },
  {
    id: "reviewer.upcoming_links",
    agent: "market_reviewer",
    file: REVIEWER_FILE,
    quote: "Upcoming events: search the economic calendar for the next two weeks (Fed decisions, CPI, PPI, PCE, the jobs report); one line per date: the date, the event, its link.",
    check: (r) => {
      const section = sectionsOf(r.reply).find((s) => /^upcoming events/i.test(s.heading));
      if (!section) return [];
      const lines = section.body.split("\n").map((l) => l.trim()).filter(Boolean);
      const unlinked = lines.filter((l) => !LINK.test(l));
      return unlinked.length ? [`${unlinked.length} of ${lines.length} upcoming events without a link`] : [];
    },
  },
  {
    id: "reviewer.note_linked",
    agent: "market_reviewer",
    file: REVIEWER_FILE,
    quote: "text: what happened, with its source linked, and what it means for these stocks, in plain words.",
    check: (r) => (r.notes ?? []).filter((n) => !LINK.test(n.text)).map((n) => `a note on ${n.tickers.join(", ")} with no link`),
  },

  // The portfolio digest.
  {
    id: "digest.every_proposal",
    agent: "portfolio_digest",
    file: DIGEST_FILE,
    quote: "Every proposal waiting, each one, none left out.",
    check: (r) => {
      const left = waitingOf(r.portfolio).filter((w) => !named(r.reply, w.ticker)).map((w) => w.ticker);
      return left.length ? [`leaves out the waiting ${left.join(", ")}`] : [];
    },
  },
  {
    id: "digest.view",
    agent: "portfolio_digest",
    file: DIGEST_FILE,
    quote: "For each: what it would do, then your own view, in plain words: would you approve it or not, and why, from what the snapshot shows",
    check: (r) => {
      // The paragraph that names the proposal says whether to approve it.
      const view = /\b(approv\w*|declin\w*|pass on|skip|say (?:yes|no)|hold off|wouldn't|would not|I'd|I would|not yet|let it)\b/i;
      const paragraphs = r.reply.split(/\n\s*\n/);
      return waitingOf(r.portfolio)
        .filter((w) => named(r.reply, w.ticker) && !paragraphs.some((p) => named(p, w.ticker) && view.test(p)))
        .map((w) => `no view on the waiting ${w.ticker}`);
    },
  },
  {
    id: "digest.no_stock",
    agent: "portfolio_digest",
    file: DIGEST_FILE,
    quote: "Never invent a number, a reason or a stock.",
    check: (r) => {
      const known = new Set(tickersIn(r.portfolio ?? ""));
      const left = tickersIn(r.reply).filter((t) => !known.has(t));
      return left.length ? [`names ${left.join(", ")}, not in the snapshot`] : [];
    },
  },
  {
    id: "digest.price_level",
    agent: "portfolio_digest",
    file: DIGEST_FILE,
    quote: "Never name a new price level for a stock.",
    check: (r) => {
      const shown = dollarsIn(r.portfolio ?? "");
      const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.01);
      return [...new Set(stockPricesIn(r.reply))].filter((p) => !shown.some((s) => close(Number(p.replace(/[$,]/g, "")), s))).map((p) => `${p}, a price the snapshot doesn't have`);
    },
  },
  {
    id: "digest.cash",
    agent: "portfolio_digest",
    file: DIGEST_FILE,
    quote: "State the cash and its share of the account; never suggest what to do with it.",
    check: (r) =>
      sentences(r.reply)
        .filter((s) => /\bcash\b/i.test(s) && /\b(deploy\w*|put (?:it|that|this|some|more|the cash)? ?to work|room to (?:buy|add)|could (?:buy|add|use)|should|consider\w*|use (?:it|the cash|that cash|some)|dry powder|buying power|ready to (?:buy|add))\b/i.test(s))
        .map((s) => `"${s.slice(0, 120)}"`),
  },
  {
    id: "digest.shape",
    agent: "portfolio_digest",
    file: DIGEST_FILE,
    quote: "Write 3 to 5 short paragraphs of plain prose, with no headings and no lists:",
    check: (r) => {
      const out: string[] = [];
      const paragraphs = r.reply.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      if (paragraphs.length < 3 || paragraphs.length > 5) out.push(`${paragraphs.length} paragraphs`);
      if (/^#/m.test(r.reply)) out.push("a heading");
      if (/^\s*(?:[-*•]|\d+[.)])\s/m.test(r.reply)) out.push("a list");
      return out;
    },
  },
];

/**
 * The sentence that tells each agent not to invent a number, for the
 * yardstick's "nothing invented" grade. The Portfolio Manager has none: its
 * grade is reported, and marked as resting on no sentence of its own.
 */
export const INVENTED_QUOTES: Partial<Record<AgentId, Quote>> = {
  market_reviewer: { agent: "market_reviewer", file: REVIEWER_FILE, quote: "Every number comes from your first message or a page you found in this run. Never invent one, and never one you remember." },
  portfolio_digest: { agent: "portfolio_digest", file: DIGEST_FILE, quote: "Every number you write comes from it." },
};

/**
 * The Market Reviewer's numbers from nowhere: those neither in what it was
 * sent (within 1%) nor in a sentence that carries its link (a page it found;
 * the replay can't read the page, so a linked number is taken as sourced).
 */
export function reviewerInvented(run: Pick<RuleRun, "reply" | "notes" | "shown">): string[] {
  const unlinked = [run.reply, ...(run.notes ?? []).map((n) => n.text)].flatMap((t) => sentences(t)).filter((s) => !LINK.test(s)).join("\n");
  return inventedNumbers(unlinked, run.shown);
}

/** Every rule of an agent the run broke, by rule id. */
export function brokenRules(agent: AgentId, run: RuleRun): Broken[] {
  return RULES.filter((r) => r.agent === agent).flatMap((r) => r.check(run).map((problem) => ({ rule: r.id, problem })));
}
