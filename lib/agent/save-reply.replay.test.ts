/**
 * save-reply.replay.test.ts — a save says what the change means
 * (docs/plans/AGENT_CONTEXT.md §3.6). EME, 2026-09-29 21:33 ET: a chat armed a
 * buy at $807.42 on a score of 6 against this analyst's 7. The reply said
 * "composite 3 → 6". Through update_thesis's real entry point, on the stored row.
 */
import raw from "@/lib/agent/__fixtures__/eme-save-reply-2026-09-29.json";
import { replayTool, thesisRow, agentConfigRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const fx = raw as unknown as { minConfidence: number; price: number; thesis: Record<string, unknown> & { createdAt: string; lastReviewedAt: string; researchUpdatedAt: string }; call: Record<string, unknown> };
const seed = () => ({
  agentConfig: [agentConfigRow({ name: "Secular Compounder", minConfidence: fx.minConfidence })],
  thesis: [
    thesisRow({
      ...fx.thesis,
      createdAt: new Date(fx.thesis.createdAt),
      lastReviewedAt: new Date(fx.thesis.lastReviewedAt),
      researchUpdatedAt: new Date(fx.thesis.researchUpdatedAt),
      researchRun: { agentConfigId: REPLAY_ANALYST_ID },
    }),
  ],
});
const SCORE_LINE = "EME: This plan scores 6/10 and this analyst only buys at 7.0/10 or better (its minimum confidence). The buy will be refused the day the level fires.";

describe("EME 09-29 21:33 — the chat arms a buy its own score can't pass", () => {
  it("the save lands, and its reply says the buy will be refused (on main it said only 'composite 3 → 6')", async () => {
    const { refused, result, db } = await replayTool("update-thesis", "updateThesis", {
      seed: seed() as never,
      args: fx.call,
      ctx: { runMode: "PRINCIPAL_CHAT", minConfidence: fx.minConfidence },
      quotes: { EME: fx.price },
    });
    expect(refused).toBe(false);
    expect(result.summary).toContain("composite 3 → 6");
    expect(result.summary).toContain(`⚠ ${SCORE_LINE}`);
    expect((result.data as { what_this_means?: string[] }).what_this_means?.[0]).toContain(SCORE_LINE);
    expect((db.store.thesis as Array<{ entryPrice: number }>)[0].entryPrice).toBe(807.42); // a reply, not a refusal
  });

  it("a plan with no buy has no score line to give", async () => {
    const { result } = await replayTool("update-thesis", "updateThesis", {
      seed: seed() as never,
      args: { thesis_id: fx.thesis.id, rationale: "Reviewed: still waiting for the 50-day reclaim before any buy.", scoring: fx.call.scoring },
      ctx: { runMode: "PRINCIPAL_CHAT", minConfidence: fx.minConfidence },
      quotes: { EME: fx.price },
    });
    expect(result.summary).not.toContain("will be refused");
  });
});

describe("a note saved through update_thesis is filed by who is talking", () => {
  const noteRow = async (runMode: string) => {
    const { db } = await replayTool("update-thesis", "updateThesis", {
      seed: seed() as never,
      args: { thesis_id: fx.thesis.id, rationale: "Reviewed the base; no change to the plan today.", note: "Wait for the $807.42 close; re-score before any buy." },
      ctx: { runMode, minConfidence: fx.minConfidence },
      quotes: { EME: fx.price },
    });
    return (db.store.thesisUpdate as Array<Record<string, unknown>>).find((u) => u.type === "NOTE");
  };

  it("in /chat it is the principal's, so the analyst's next note can't replace it", async () => {
    expect(await noteRow("PRINCIPAL_CHAT")).toMatchObject({ fieldChanges: { note: { to: { author: "PRINCIPAL", via: "chat" } } } });
  });

  it("in a run it is the analyst's", async () => {
    expect(await noteRow("MORNING_PLAN")).toMatchObject({ fieldChanges: { note: { to: { author: "ANALYST", via: "MORNING_PLAN" } } } });
  });
});
