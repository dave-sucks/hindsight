/**
 * A case's context, made of stand-in text: cut from a built request and put
 * back together with the same record, it gives the same request, character
 * for character.
 */
import { composeAgentRequest } from "@/lib/agent/engine/engine";
import { BLOCKS } from "@/lib/agent/engine/blocks";
import { MARKET_REVIEWER } from "@/lib/agent/engine/agents/market-reviewer";
import { MORNING_RUN } from "@/lib/agent/engine/agents/morning-run";
import { PORTFOLIO_DIGEST } from "@/lib/agent/engine/agents/portfolio-digest";
import { PORTFOLIO_MANAGER } from "@/lib/agent/engine/agents/portfolio-manager";
import { isOwn, type AgentRecord, type BlockPart } from "@/lib/agent/engine/types";
import type { PortfolioPiece } from "@/lib/agent/portfolio-block";
import { CONTEXT_NAMES, contextFromHeadings, contextFromParts, loadedFrom, OPENINGS, sentOf } from "./context";

const INPUT = { now: new Date("2026-11-17T15:00:00Z"), environment: "LIVE" as const };
const PIECE_TITLES: Record<string, string> = { market_numbers: "Market numbers (as of Tue, Nov 17, 10:00 AM)", market_digest: "Market digest (written Tue, Nov 17, 7:31 AM)", portfolio_snapshot: "Portfolio snapshot", watching: "Watching", portfolio_digest: "Portfolio digest" };

/** Stand-in text for every block a record reads: a Market and portfolio part under its own heading. */
function standIn(record: AgentRecord) {
  const pieces: PortfolioPiece[] = [];
  const blocks: Record<string, string | null> = {};
  for (const p of [...record.instructions, ...record.message].filter((x): x is BlockPart => !isOwn(x))) {
    const grouped = Boolean(BLOCKS[p.block].group) && !p.alone && p.heading == null;
    if (grouped) pieces.push({ id: p.block as PortfolioPiece["id"], text: `### ${PIECE_TITLES[p.block]}\nStand-in ${p.block}, line one.\nLine two.` });
    else blocks[p.block] = `${OPENINGS[p.block] ? `${OPENINGS[p.block]}${OPENINGS[p.block]!.endsWith(" ") ? "" : "\n"}` : ""}Stand-in ${p.block}.\nIts second line.`;
  }
  return { pieces, blocks };
}

describe("a case's context", () => {
  it.each([PORTFOLIO_MANAGER, MARKET_REVIEWER, PORTFOLIO_DIGEST, MORNING_RUN].map((r) => [r.id, r] as const))("%s: cut by its parts and put back, the same request", (_id, record) => {
    const built = composeAgentRequest(record, INPUT, standIn(record));
    const context = contextFromParts(record, built, built.parts);
    for (const c of context) expect(c.name).toBe(CONTEXT_NAMES[c.block]);
    const { loaded, missing } = loadedFrom(record, context);
    expect(missing).toEqual([]);
    const again = composeAgentRequest(record, INPUT, loaded);
    expect(again.instructions).toBe(built.instructions);
    expect(again.message).toBe(built.message);
  });

  it.each([PORTFOLIO_MANAGER, PORTFOLIO_DIGEST, MORNING_RUN].map((r) => [r.id, r] as const))("%s: a request saved without its parts is cut by its headings", (_id, record) => {
    const built = composeAgentRequest(record, INPUT, standIn(record));
    const again = composeAgentRequest(record, INPUT, loadedFrom(record, contextFromHeadings(record, built)).loaded);
    expect(again.instructions).toBe(built.instructions);
    expect(again.message).toBe(built.message);
  });

  it("the Portfolio Manager's context is stored under the names it will have", () => {
    const built = composeAgentRequest(PORTFOLIO_MANAGER, INPUT, standIn(PORTFOLIO_MANAGER));
    expect(contextFromHeadings(PORTFOLIO_MANAGER, built).map((c) => `${c.block}→${c.name}`)).toEqual([
      "market_numbers→market_numbers",
      "market_digest→market_digest",
      "portfolio_snapshot→portfolio",
      "watching→the_book",
      "last_writeup→last_output",
    ]);
  });

  it("a block the run didn't print is stored as none, and one today's record adds is named as missing", () => {
    const loaded = standIn(MARKET_REVIEWER);
    loaded.blocks.reviewer_notes = null;
    const built = composeAgentRequest(MARKET_REVIEWER, INPUT, loaded);
    const context = contextFromParts(MARKET_REVIEWER, built, built.parts);
    expect(context.find((c) => c.block === "reviewer_notes")!.text).toBeNull();
    expect(loadedFrom(MARKET_REVIEWER, context.filter((c) => c.block !== "last_digest")).missing).toEqual(["last_digest"]);
  });

  it("a block that was the record's own text when the run was sent is found by its heading", () => {
    const built = composeAgentRequest(MORNING_RUN, INPUT, standIn(MORNING_RUN));
    // The morning run's regime was its own text until it became a block.
    const parts = built.parts.map((p) => (p.id === "regime" ? { ...p, kind: "own" as const } : p));
    expect(contextFromParts(MORNING_RUN, built, parts).find((c) => c.block === "regime")!.text).toBe("## Regime and cash\nStand-in regime.\nIts second line.");
  });

  it("reads a saved body's instructions and first message, from either API", () => {
    expect(sentOf({ messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }] })).toEqual({ instructions: "S", message: "U" });
    expect(sentOf({ input: [{ role: "developer", content: "S" }, { role: "user", content: [{ type: "input_text", text: "U" }] }] })).toEqual({ instructions: "S", message: "U" });
  });
});
