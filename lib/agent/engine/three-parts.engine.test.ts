/**
 * The morning run, the trigger run and the post-trade write-up, the Writer
 * and the Holding refresh, and the chat, on the three parts: each part's
 * words are the old builder's (./__fixtures__/before.ts), or changed only by
 * the moves docs/plans/AGENT_ENGINE.md names:
 * - the house rules carry the line on weighing the Market and portfolio
 *   context again (it was its own block for a day);
 * - the analyst's text carries its fence (sectors, market cap, exclusions)
 *   where it narrows, which was the chat's scope block;
 * - the date line opens every first message; the run's task is its message;
 * - the morning run's regime rules are its own text, the watched stocks at
 *   their buy price its kickoff, its refused calls a read;
 * - the trigger run's fire is said once, in the message from the trigger check;
 * - the Writer's five rule texts are one, its own text one, its brief its
 *   message, and on a refresh the stock is its row;
 * - the chat's book and each analyst's room ride on your newest message.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { before, partsOf } from "./__fixtures__/before";
import { MORNING_CASES, asRunInput, type MorningCaseName } from "./__fixtures__/morning-run-cases";
import { TRIGGER_CASES, TRIGGER_KICKOFF, type TriggerCaseName } from "./__fixtures__/trigger-run-cases";
import { WRITER_CASES, WRITER_MESSAGE } from "./__fixtures__/writer-cases";
import { CHAT_CASES } from "./__fixtures__/chat-cases";
import { dailyRunRequest } from "@/lib/agent/system-prompt";
import { triggerRunRequest } from "@/lib/agent/system-prompts/intraday-tactical";
import { writerRequest } from "@/lib/agent/run-thesis-writer";
import { analystsText, chatNewest, chatRequest } from "@/lib/agent/system-prompts/chat";
import { fenceLines, type UniverseAnalyst } from "@/lib/agent/analyst-brief";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { writtenNote } from "@/lib/agent/triggers/note";
import type { Trigger } from "@/lib/agent/triggers/types";
import { dateLine } from "./engine";

const NOW = new Date("2026-11-17T15:55:00Z");
/** The analyst's text with its fence after its slots, where it narrows: the one change to the analyst. */
const withFence = (old: string, a: UniverseAnalyst) => {
  const fence = fenceLines(a).map((l) => `- ${l}`);
  return fence.length ? old.replace(/(- Max open positions: \d+)/, `$1\n${fence.join("\n")}`) : old;
};
/** The house rules with the line on weighing the Market and portfolio context back in. */
const MARKET_RULE = before("morning.quiet")["instructions:market_block_rule"];
const house = (old: Record<string, string>) => `${old["instructions:house_rules"]}\n\n${MARKET_RULE}`;
const count = (text: string, part: string) => text.split(part).length - 1;

describe("the morning run", () => {
  const names = Object.keys(MORNING_CASES) as MorningCaseName[];
  const build = (name: MorningCaseName) => {
    const c = MORNING_CASES[name] as { analyst: never; runInput: unknown; pieces?: never };
    return dailyRunRequest(c.analyst, { ...asRunInput(c.runInput), portfolioPieces: c.pieces ?? undefined }, NOW);
  };

  it.each(names)("%s: every part is the old one's, moved as the plan says", (name) => {
    const old = before(`morning.${name}`);
    const now = partsOf(build(name));
    const c = MORNING_CASES[name] as { analyst: UniverseAnalyst; runInput: { triggersMatchingNow?: Array<{ action: string; ticker: string }> } };
    expect(now["instructions:the_analyst"]).toBe(withFence(old["instructions:analyst_brief"], c.analyst));
    // The regime's rules are its own text now; the cash is in the snapshot, the watched stocks at their buy price in the kickoff.
    const regime = old["instructions:regime"]
      .replace(/^(## Regime and cash\n)(?:Your cash is in the portfolio snapshot below\.|Cash is \$[\d,]+\.)/, "$1Your cash is in the portfolio snapshot.")
      .replace(/a watch name at its buy level(?: \(today: [^)]*\))?/, "a watch name at its buy level (the start of the day names them)");
    expect(now["instructions:own"]).toBe(`${old["instructions:instructions"]}\n\n${regime}`);
    expect(now["instructions:house_rules"]).toBe(house(old));
    expect(now["instructions:how_you_write"]).toBe(old["instructions:how_you_write"]);
    for (const [was, is] of [["market_numbers", "market_numbers"], ["market_digest", "market_digest"], ["portfolio_snapshot", "portfolio"], ["portfolio_digest", "portfolio_digest"], ["earnings_week", "earnings_this_week"], ["filings_week", "filings_this_week"]]) {
      expect([is, now[`message:${is}`]]).toEqual([is, old[`message:${was}`]]);
    }
    expect(now["message:refused_calls"]).toBe(old["instructions:blocked_last_time"]);
    const atBuy = (c.runInput.triggersMatchingNow ?? []).filter((t) => t.action === "ENTER").map((t) => t.ticker);
    // The cash the regime line said when the snapshot couldn't be read is the kickoff's now.
    const cash = old["instructions:regime"].match(/Cash is (\$[\d,]+)\./)?.[1];
    expect(now["message:message"]).toBe(
      `${old["message:kickoff"]}${cash ? `\n\nThe portfolio snapshot couldn't be read: cash is ${cash}.` : ""}${atBuy.length ? `\n\nWatched stocks at their buy price this morning: ${atBuy.join(", ")}.` : ""}`,
    );
    expect(now["message:line"]).toBe(dateLine(NOW, "PAPER"));
    expect(Object.keys(now).filter((k) => k.startsWith("instructions:"))).toEqual(["instructions:the_analyst", "instructions:own", "instructions:house_rules", "instructions:how_you_write"]);
  });
});

describe("a trigger fire: the trigger run and the post-trade write-up", () => {
  const names = Object.keys(TRIGGER_CASES) as TriggerCaseName[];
  const args = (name: TriggerCaseName) => {
    const { pieces, ...rest } = TRIGGER_CASES[name] as (typeof TRIGGER_CASES)[TriggerCaseName] & { pieces?: unknown };
    return { ...(rest as never as Parameters<typeof triggerRunRequest>[0]), portfolioPieces: (pieces as never) ?? null };
  };
  const more = `${TRIGGER_KICKOFF.contextSuffix}${TRIGGER_KICKOFF.coFiredSuffix}`;

  it.each(names)("%s: every part is the old one's, and the fire is said once, in the message", (name) => {
    const old = before(`trigger.${name}`);
    const built = triggerRunRequest(args(name), { more }, NOW);
    const now = partsOf(built);
    const a = args(name);
    expect(now["instructions:the_analyst"]).toBe(withFence(old["instructions:analyst_brief"], a.analyst as UniverseAnalyst));
    expect(now["instructions:own"]).toBe(old["instructions:instructions"]);
    expect(now["instructions:house_rules"]).toBe(house(old));
    expect(now["instructions:how_you_write"]).toBe(old["instructions:how_you_write"]);
    // The playbooks, on a review of a watch, are a shared text now; the situations still end the instructions.
    expect(now["instructions:playbooks"]).toBe(old["message:playbooks"]);
    expect(now["instructions:situations"]).toBe(old["instructions:situations"]);
    for (const [was, is] of [["market_numbers", "market_numbers"], ["market_digest", "market_digest"], ["portfolio_snapshot", "portfolio"], ["portfolio_digest", "portfolio_digest"], ["stock_row", "the_stock"]]) {
      expect([is, now[`message:${is}`]]).toEqual([is, old[`message:${was}`]]);
    }
    // The message: the trigger and its price once, what else the check knows, then the old ask.
    const t = a.trigger as Trigger;
    const message = now["message:message"];
    expect(message.endsWith(`\n\n${old["message:ask"]}`)).toBe(true);
    expect(count(message.replace(more, ""), sentenceOf(t))).toBe(1);
    // Its declared action, as the old "declared action:" line said it: the instructions act on it.
    const declared = old["message:fired_trigger"].match(/declared action: (.+)/)![1];
    expect(message).toContain(`(trigger ${t.id}${t.source === "PRINCIPAL" ? ", which the principal wrote" : ""}; declared action: ${declared})`);
    if (a.fired?.price != null) expect(message).toContain(`fired at $${a.fired.price.toFixed(2)}`);
    expect(message).toContain(TRIGGER_KICKOFF.coFiredSuffix.trim());
    // The trigger's note is said once in the whole request: beside its id on the row, or in the message when there is no row.
    const note = writtenNote(t);
    if (note) expect(count(built.instructions + built.message, note)).toBe(1);
    // A give-back off the high keeps its check on the tracked high.
    if (old["message:fired_trigger"].includes("THE PEAK IS AUTHORITATIVE")) expect(message).toContain("THE PEAK IS AUTHORITATIVE");
  });

  it("the write-up's message says the trade the Auto trigger made", () => {
    const message = partsOf(triggerRunRequest(args("auto_sale"), { more }, NOW))["message:message"];
    expect(message).toContain("It is set to Auto, so no analyst decided. The sale of 60 shares is waiting for your approval.");
    expect(message.startsWith("Write-up on $CASE.")).toBe(true);
  });
});

describe("the Writer and the Holding refresh", () => {
  const names = Object.keys(WRITER_CASES) as Array<keyof typeof WRITER_CASES>;
  const RESEARCH = ["date_awareness", "research_note", "thesis_claim", "earnings_triggers", "what_the_owner_reads"];
  /** The four sentences of its own text that named where the old blocks were. */
  const own = (job: string, decision: string) =>
    `${job}\n\n${decision}`
      .replace("a refresh starts from the existing thesis in the first message, not from scratch", "a refresh starts from the existing thesis (the stock's row in the first message), not from scratch")
      .replace("The refresh starts from the existing thesis in the first message, not from scratch", "The refresh starts from the existing thesis (the stock's row in the first message), not from scratch")
      .replace("send remove_trigger_ids naming the buy and Stop watching ids from the existing thesis", "send remove_trigger_ids naming the buy and Stop watching ids from the stock's row")
      .replace("- The promotion (this refresh is part of a PAPER→LIVE promotion):", "- A promotion (the row's paper_record: this refresh is part of a PAPER→LIVE promotion):")
      .replace("(edit_triggers, by its id in the existing thesis)", "(edit_triggers, by its id on the stock's row)");

  it.each(names)("%s: every part is the old one's, moved as the plan says", (name) => {
    const old = before(`writer.${name}`);
    const c = WRITER_CASES[name] as Parameters<typeof writerRequest>[0];
    const now = partsOf(writerRequest({ ...c, stockRow: c.existingThesis ? { stock: "CASE" } : null }, WRITER_MESSAGE, NOW));
    expect(now["instructions:the_analyst"]).toBe(withFence(old["instructions:analyst_brief"], c.analyst));
    expect(now["instructions:house_rules"]).toBe(`${old["instructions:house_rules"]}\n\n${old["instructions:market_block_rule"]}`);
    expect(now["instructions:how_you_write"]).toBe(old["instructions:how_you_write"]);
    expect(now["instructions:playbooks"]).toBe(old["instructions:playbooks"]);
    expect(now["instructions:research_rules"]).toBe(RESEARCH.map((k) => old[`instructions:${k}`]).join("\n\n"));
    expect(now["instructions:own"]).toBe(own(old["instructions:job"], old["instructions:decision"]));
    expect(now["message:playbook_record"]).toBe(old["message:setup_record"]);
    expect(now["message:stock_data"]).toBe(old["message:stock_data"]);
    // The thesis now and a promotion are the stock's row; a recent sale is in the data's history.
    expect(now["message:the_stock"] != null).toBe(old["message:existing_thesis"] != null);
    // Its message is the sender's brief as the old message had it, then the ask.
    const brief = ["why_sent", "sender_notes", "idea_source", "chat_found", "go"].map((k) => old[`message:${k}`]).filter(Boolean);
    expect(now["message:message"]).toBe(brief.join("\n\n"));
  });
});

describe("the chat", () => {
  it.each(Object.keys(CHAT_CASES) as Array<keyof typeof CHAT_CASES>)("%s: every part is the old one's, moved as the plan says", (name) => {
    const old = before(`chat.${name}`);
    const c = CHAT_CASES[name] as { scopedAnalyst: (UniverseAnalyst & { id: string; name: string }) | null; room?: never; roomLines?: string[] };
    const now = partsOf(chatRequest({ scopedAnalyst: c.scopedAnalyst, room: c.room }));
    expect(now["instructions:own"]).toBe(
      old["instructions:instructions"].replace(
        "When these instructions end with an analyst's blocks (its scope, its brief, its money and its book), this chat is pinned to one analyst.",
        "When these instructions end with an analyst (its strategy, its rules and its playbooks), this chat is pinned to one analyst, and its book rides on each of your messages.",
      ),
    );
    expect(now["instructions:house_rules"]).toBe(house(old));
    expect(now["instructions:how_you_write"]).toBe(old["instructions:how_you_write"]);
    if (c.scopedAnalyst) expect(now["instructions:the_analyst"]).toBe(withFence(old["instructions:analyst_brief"], c.scopedAnalyst));
    else expect(now["instructions:the_analyst"]).toBeUndefined();
    // Each analyst's room rides on your newest message, under the heading it had.
    const newest = partsOf({ ...chatRequest({ scopedAnalyst: null }), parts: [] }, chatNewest(NOW, null, "PAPER", { analysts: analystsText(c.roomLines ?? []) }));
    if (c.roomLines) expect(newest["newest:the_analysts"]).toBe(old["instructions:analyst_rooms"]);
    expect(newest["newest:line"]).toBe(dateLine(NOW, "PAPER"));
  });
});
