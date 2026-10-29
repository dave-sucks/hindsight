/**
 * The Overview's Recent activity: the Activity tab's own rows, the newest few
 * with words, never a proposal and never text already on the page above.
 * NVDA's rows on 2026-10-28 (rationales cut to their first words).
 */
import { buildTimeline, dropRepeatedProse, recentRows, toRow, type TimelineUpdate } from "./thesis-timeline-utils";

const u = (p: Partial<TimelineUpdate> & Pick<TimelineUpdate, "id" | "type" | "summary" | "timestamp">): TimelineUpdate => ({
  rationale: null, fieldChanges: {}, priceAtTime: null, positionAtTime: null, triggerId: null, signalIds: [], runId: null, tradeId: null, ...p,
});

const CHAT = "Keeping the position — analyst targets ($275 low, $347 average, $515 high across 44 analysts) are too strong to exit flat.";
const TRIGGER_RUN = "NVIDIA is $219.29 on Oct. 28, still below the $236 stop you raised after the run.";
const MORNING = "NVIDIA closed at $217.94 on Oct. 27, down 10.4% from the Oct. 6 high of $243.37.";
const CARD = "NVIDIA is $219.29 this morning, still well under the $236 stop you had raised after the run.";

const NVDA: TimelineUpdate[] = [
  u({ id: "r1", type: "REVIEWED", summary: "Reviewed NVDA thesis — no changes", rationale: CHAT, runId: "chat", priceAtTime: 218.4, timestamp: "2026-10-28T13:48:04Z" }),
  u({ id: "p1", type: "PROPOSAL_PROPOSED", summary: "CLOSE proposal on NVDA", rationale: CARD, timestamp: "2026-10-28T13:31:18Z" }),
  u({ id: "r2", type: "UPDATED", summary: "Updated NVDA: Removed: Review if above $243", rationale: TRIGGER_RUN, triggerId: "6306", runId: "tr", priceAtTime: 219.55, timestamp: "2026-10-28T13:31:24Z" }),
  u({ id: "f1", type: "TRIGGER_FIRED", summary: "Sell if below $236", triggerId: "6306", runId: "tr", priceAtTime: 219.29, timestamp: "2026-10-28T13:30:49Z" }),
  u({ id: "e1", type: "PROPOSAL_EXPIRED", summary: "CLOSE proposal on NVDA expired without user decision", rationale: "The sale of 33 NVDA expired without an answer.", timestamp: "2026-10-28T12:30:40Z" }),
  u({ id: "r3", type: "UPDATED", summary: "Updated NVDA: Target set: $243", rationale: MORNING, runId: "am", priceAtTime: 217.94, timestamp: "2026-10-28T12:01:52Z" }),
  u({ id: "e2", type: "PROPOSAL_EXPIRED", summary: "CLOSE proposal on NVDA expired without user decision", rationale: "The sale of 33 NVDA expired without an answer.", timestamp: "2026-10-27T12:30:33Z" }),
];

const rows = () => dropRepeatedProse(buildTimeline(NVDA, "all").map(toRow));

describe("Recent activity on the Overview", () => {
  it("NVDA: the trigger run's answer and the morning note; the chat note (shown large above), the proposal and the expiries are left out", () => {
    const kept = recentRows(rows(), [CHAT, CARD], 3);
    expect(kept.map((r) => r.description)).toEqual([TRIGGER_RUN, MORNING]);
  });
  it("with nothing shown above, the newest note leads, and the list stops at the limit", () => {
    expect(recentRows(rows(), [], 2).map((r) => r.description)).toEqual([CHAT, TRIGGER_RUN]);
  });
  it("text above is matched whatever its spacing", () => {
    expect(recentRows(rows(), [`  ${CHAT.replace(/ /g, "  ")}\n`], 3)[0].description).toBe(TRIGGER_RUN);
  });
});
