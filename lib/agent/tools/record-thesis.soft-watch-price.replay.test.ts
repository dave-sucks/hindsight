/**
 * A soft watch records what the stock cost when we started watching it.
 *
 * ABBV, FTNT and MA were minted on 2026-09-28 at 22:47 ET by the soft-watch
 * path, and each wrote a CREATED row with `priceAtTime: null`. Their coverage
 * rows then had nothing to anchor to, so the "since you started watching"
 * column was blank on all three.
 *
 * The cause was two-fold and both halves are fixed here:
 *   - the quote was only fetched when `direction !== "PASS"`, and a soft watch
 *     IS a PASS, so there was no observed price in scope at all;
 *   - the CREATED row stamped `args.entry_price`, the PLANNED buy level, which
 *     a soft watch by definition does not have.
 *
 * The args below are reconstructed from the stored ABBV row — its direction,
 * status, source kind and its two REVIEW triggers — not from the run's own
 * messages, which were not retrievable for that run. The assertion is narrow
 * enough that this is the whole input it depends on.
 */
import { replayTool, agentConfigRow, accountRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const SOFT_WATCH_ARGS = {
  ticker: "ABBV",
  direction: "PASS" as const,
  status: "WATCHING" as const,
  reasoning_summary:
    "Large-cap pharma outside the catalyst window — no dated event to trade. Keeping it in view in case a setup forms.",
  source_kind: "WEB_SEARCH" as const,
  source_rationale: "From the discovery paste.",
  triggers: [
    { predicate: { watch: "price", is: "below", value: 190 }, action: "REVIEW" as const, rationale: "Pullback — look again." },
    { predicate: { watch: "price", is: "above", value: 230 }, action: "REVIEW" as const, rationale: "Breakout — look again." },
  ],
};

describe("record_thesis — a soft watch stamps the price it was watched at", () => {
  it("writes the live price on the CREATED row, not the (absent) entry price", async () => {
    const { refused, refusal, db } = await replayTool("record-thesis", "recordThesis", {
      seed: { agentConfig: [agentConfigRow({})], account: [accountRow()] },
      ctx: { runMode: "PRINCIPAL_CHAT", analystId: REPLAY_ANALYST_ID },
      args: SOFT_WATCH_ARGS,
      quotes: { ABBV: 203.11 },
    });

    expect(refusal).toBeNull();
    expect(refused).toBe(false);

    const thesis = db.store.thesis.find((t) => t.ticker === "ABBV");
    expect(thesis?.status).toBe("WATCHING");
    // A soft watch has no planned buy — that is what makes it soft, and what
    // made the old code stamp nothing.
    expect(thesis?.entryPrice ?? null).toBeNull();

    const created = db.store.thesisUpdate.filter((u) => u.type === "CREATED");
    expect(created).toHaveLength(1);
    // THE REGRESSION: this was null, so the row had no anchor.
    expect(Number(created[0].priceAtTime)).toBeCloseTo(203.11, 2);
  });
});
