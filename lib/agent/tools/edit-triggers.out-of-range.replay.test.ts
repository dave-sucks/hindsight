/**
 * An edit is held to the catalog's range, as an add is. AXGN, 2026-11-23 13:02
 * ET, run cmwt9z7d6003p08l56obsqfhr: the run read the 20-day average at $51.22
 * and sent that price as the new number on "Buy if within 2% of the 20-day
 * average". The edit path checked only that the number was positive, so it
 * saved "within 51.22%", a buy true at almost any price. The call below is the
 * recorded one; the trigger is the stored one before it.
 */
import { replayTool, thesisRow, REPLAY_ANALYST_ID } from "@/lib/replay";

const ID = "ed5bf9ed-8f00-410f-875a-2675ce7de8e9";
const BUY = { id: ID, action: "ENTER", predicate: { watch: "move", is: "near", value: 2, variable: "sma20" }, rationale: "A pullback to the rising 20-day average." };
const seed = () => ({ thesis: [thesisRow({ id: "axgn", ticker: "AXGN", status: "WATCHING", direction: "LONG", triggers: [BUY] })] });
const run = (value: number) =>
  replayTool("edit-triggers", "editTriggers", {
    seed: seed(),
    ctx: { runMode: "MORNING", analystId: REPLAY_ANALYST_ID },
    args: { thesis_id: "axgn", edit: [{ id: ID, value, rationale: "The 20-day average has risen to $51.22, so the pullback review needs to move up with it." }] },
    quotes: { AXGN: 55.75 },
  });
const opOf = (r: unknown) => (r as { data?: { trigger_ops?: Array<{ id: string; ok: boolean; reason?: string }> } }).data?.trigger_ops?.find((o) => o.id === ID);
const stored = (db: { store: Record<string, unknown[]> }) => (db.store.thesis[0] as { triggers: Array<{ predicate: { value: number } }> }).triggers[0].predicate.value;

describe("a price can't be saved into a percent field", () => {
  it("refuses AXGN's edit with the fix, and the trigger stays at 2%", async () => {
    const { result, db } = await run(51.22);
    const op = opOf(result);
    expect(op?.ok).toBe(false);
    expect(op?.reason).toContain("Within an average takes more than 0% and up to 10%; 51.22% isn't.");
    expect(op?.reason).toContain("To act at a price, remove this trigger and add one on the price.");
    expect(stored(db)).toBe(2);
  });
  it("a % inside the range still lands", async () => {
    const { result, db } = await run(3);
    expect(opOf(result)?.ok).toBe(true);
    expect(stored(db)).toBe(3);
  });
});
