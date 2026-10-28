/**
 * A trigger's note reaches a run only when someone wrote it. The account's
 * trail rule (set 2026-10-25) carried "below 6% from the high since we bought
 * — standing rule set by the principal.", which every sale-signal run was
 * shown as the reason the trigger was set.
 */
import { defaultNote, writtenNote } from "./note";

const TRAIL = { action: "EXIT" as const, predicate: { watch: "move", is: "below", value: 6, variable: "peak" } };
const FLOOR = { action: "EXIT" as const, predicate: { watch: "price", is: "below", value: 401.91 } };

describe("a trigger's note", () => {
  it("the account rule's old default is not a note", () => {
    expect(writtenNote({ ...TRAIL, rationale: "below 6% from the high since we bought — standing rule set by the principal." })).toBeNull();
  });
  it("the default the owner's triggers get is not a note (V's floor, 2026-10-28)", () => {
    expect(defaultNote(FLOOR.action, FLOOR.predicate as never)).toBe("Sell if below $401.91. You set this.");
    expect(writtenNote({ ...FLOOR, rationale: "Sell if below $401.91. You set this." })).toBeNull();
  });
  it("a note someone wrote is kept, word for word", () => {
    expect(writtenNote({ ...FLOOR, rationale: "Under the September base low, the structure we were protecting." })).toBe(
      "Under the September base low, the structure we were protecting.",
    );
  });
  it("no note is no note", () => {
    expect(writtenNote({ ...FLOOR, rationale: "  " })).toBeNull();
  });
});
