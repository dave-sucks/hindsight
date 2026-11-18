/**
 * The morning run on the agent engine: its own text is one fixed text, the
 * same on every run, after the analyst it works for; its instructions end
 * with what travels with the run (the regime and cash, the calls refused last
 * time), and every fact (the market and portfolio, the book's earnings and
 * filings this week) is a block of its first message. The cases are the
 * shapes the run takes (./__fixtures__/morning-run-cases.ts).
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { MORNING_CASES, asRunInput, type MorningCaseName } from "./__fixtures__/morning-run-cases";
import { dailyRunRequest } from "@/lib/agent/system-prompt";
import { MORNING_RUN } from "./agents/morning-run";
import { isOwn, type BuiltRequest } from "./types";
import { rowsOf } from "./__fixtures__/rows-of";

const build = (name: MorningCaseName) => {
  const c = MORNING_CASES[name] as (typeof MORNING_CASES)[MorningCaseName] & { pieces?: unknown };
  return dailyRunRequest(c.analyst as never, { ...asRunInput(c.runInput), portfolioPieces: (c.pieces as never) ?? undefined });
};
const names = Object.keys(MORNING_CASES) as MorningCaseName[];
/** One part's text as sent, by its id; null when the run left it out. */
const partOf = (built: BuiltRequest, id: string) => {
  const at: Record<string, number> = { instructions: 0, message: 0 };
  for (const p of built.parts) {
    const text = p.where === "instructions" ? built.instructions : built.message;
    at[p.where] += (p.sep ?? "").length;
    if (p.id === id) return text.slice(at[p.where], at[p.where] + p.chars);
    at[p.where] += p.chars;
  }
  return null;
};
const KICKOFF =
  "It's the start of the trading day. Run your morning playbook unattended — there is no human to respond to questions. Every turn must call a tool; text-only turns terminate the run as FAILED. End with complete_run.";

describe("the morning run on the engine", () => {
  it("its own words are one fixed text, with no part that changes by run and no separator of its own", () => {
    for (const part of [...MORNING_RUN.instructions, ...MORNING_RUN.message]) {
      expect(part.sep).toBeUndefined();
      if (isOwn(part)) expect([part.own, typeof part.text]).toEqual([part.own, "string"]);
    }
  });

  it("the fixed text is the same in every shape: headings, no banners, nothing about the book", () => {
    const fixed = names.map((n) => partOf(build(n), "instructions"));
    expect(new Set(fixed).size).toBe(1);
    const text = fixed[0]!;
    expect(build("full").instructions.startsWith(`${partOf(build("full"), "analyst_brief")}\n\n${text}`)).toBe(true);
    for (const heading of ["## How you work", "## Your job", "## How tools work"]) expect(text).toContain(`${heading}\n\n`);
    expect(text).not.toContain("═");
    for (const fact of ["Case Analyst", "$AAA", "CCC", "41,000", "Regime"]) expect([fact, text.includes(fact)]).toEqual([fact, false]);
  });

  it("the analyst opens the instructions; the regime and the refused calls end them, the refused calls only when there are some", () => {
    const full = build("full");
    expect(full.parts.filter((p) => p.where === "instructions").map((p) => p.id)).toEqual(["analyst_brief", "instructions", "house_rules", "how_you_write", "regime", "blocked_last_time"]);
    expect(full.instructions.startsWith("## Analyst: Case Analyst\n")).toBe(true);
    expect(full.instructions.indexOf("## Regime and cash")).toBeGreaterThan(full.instructions.indexOf("## How tools work"));
    expect(full.instructions.endsWith("- 2026-11-16: Buy on $CCC (place_trade) — refused: The buy was refused: no sell price.")).toBe(true);
    const quiet = build("quiet");
    expect(quiet.instructions).not.toContain("## Blocked last time");
    expect(quiet.instructions.endsWith("Idle cash with a live setup is a decision, not a quiet day.")).toBe(true);
  });

  it("the regime says the cash only when the snapshot couldn't be read, and names the watches at their buy price", () => {
    expect(partOf(build("full"), "regime")).toContain("## Regime and cash\nYour cash is in the portfolio snapshot below.");
    expect(partOf(build("full"), "regime")).toContain("a watch name at its buy level (today: CCC), and a risk-on market");
    expect(partOf(build("snapshot_unread"), "regime")).toContain("## Regime and cash\nCash is $31,000.");
    expect(partOf(build("quiet"), "regime")).toContain("a watch name at its buy level, and a risk-on market");
  });

  it("the first message carries the market and portfolio and the book's week, then the start of the day", () => {
    const { instructions, message } = build("full");
    const at = (s: string) => message.indexOf(s);
    expect(message.startsWith("## Market and portfolio\n\n### Market numbers")).toBe(true);
    expect(at("## Earnings on your book this week")).toBeGreaterThan(at("### Portfolio digest"));
    expect(at("## Filings on your book this week")).toBeGreaterThan(at("## Earnings on your book this week"));
    expect(message.endsWith(`\n\n${KICKOFF}`)).toBe(true);
    for (const fact of ["## Market and portfolio", "## Earnings on your book", "## Filings on your book"]) expect([fact, instructions.includes(fact)]).toEqual([fact, false]);
    expect(message).not.toContain("## Analyst:");
    expect(build("filings_unread").message).toContain("## Filings on your book this week\nFilings unavailable: EDGAR timed out");
    expect(build("quiet").message).not.toMatch(/## (Earnings|Filings) on your book/);
  });

  it("names every part, and the parts add up to what is sent", () => {
    expect(rowsOf(build("full"))?.map((r) => r.name)).toEqual([
      "The analyst",
      "Its instructions",
      "House rules",
      "How you write",
      "Regime and cash",
      "Refused calls never redone",
      "Market numbers",
      "Market digest",
      "Portfolio snapshot",
      "Portfolio digest",
      "Earnings this week",
      "Filings this week",
      "The start",
    ]);
    expect(rowsOf(build("quiet"))?.map((r) => r.name)).toEqual(["The analyst", "Its instructions", "House rules", "How you write", "Regime and cash", "The start"]);
  });
});
