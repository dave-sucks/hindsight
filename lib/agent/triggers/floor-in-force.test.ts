/**
 * floor-in-force.test.ts — the floor a held stock is protected by, read off
 * its stored ladder (thesisFloorStop). Moved here from
 * manage-position.stop-ratchet.test.ts when manage_position's two
 * level-moving actions were deleted (step 12, part 3); update_thesis's
 * declined-sale rule still reads it.
 */
import { thesisFloorStop } from "./floor-in-force";
import type { Trigger } from "./types";

/** NVDA's real ladder. `floor` is the level on its hard-stop rung. */
const ladder = (floor: number) =>
  [
    { id: "d9c8dabf", action: "REVIEW", source: "DEFAULT", predicate: { watch: "repeat", value: 7 }, rationale: "Look at this every 7 days.", cooldownDays: 7 },
    { id: "6306936b", action: "EXIT", source: "DEFAULT", predicate: { watch: "price", is: "below", value: floor }, rationale: `Hard stop at $${floor}.`, cooldownDays: 0 },
    { id: "8f58e347", action: "REVIEW", source: "DEFAULT", predicate: { watch: "price", is: "above", value: 322 }, rationale: "Target $322 hit.", cooldownDays: 1 },
    { id: "d7d37522", action: "REVIEW", source: "DEFAULT", predicate: { watch: "move", is: "below", value: 12, variable: "entry" }, rationale: "Down 12% from entry.", cooldownDays: 7 },
  ] as unknown as Trigger[];

describe("thesisFloorStop", () => {
  it("reads the hard stop off the ladder", () => {
    expect(thesisFloorStop({ triggers: ladder(215), direction: "LONG", avgCost: 218.2259 })).toBe(215);
  });
  it("an empty or floorless ladder has no floor", () => {
    expect(thesisFloorStop({ triggers: [], direction: "LONG" })).toBeNull();
  });
});
