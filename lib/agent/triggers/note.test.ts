/**
 * A trigger's note reaches a run only when someone wrote it. The account's
 * trail rule (set 2026-10-25) carried "below 6% from the high since we bought
 * — standing rule set by the principal.", which every sale-signal run was
 * shown as the reason the trigger was set.
 */
import { defaultNote, writtenNote } from "./note";
import type { Trigger } from "./types";
import cegRaw from "@/lib/agent/__fixtures__/ceg-floor-too-far-2026-09-30.json";
import closeOutRaw from "@/lib/agent/__fixtures__/close-out-restated-2026-10-08.json";
import gevRaw from "@/lib/agent/__fixtures__/gev-hold-after-lapse-2026-10-28.json";

const ceg = cegRaw as unknown as { thesisBefore: { triggers: Trigger[] }; analyst: { triggers: Trigger[] } };
const closeOut = closeOutRaw as unknown as { CEG: { thesis: { triggers: Trigger[] } } };
const gev = gevRaw as unknown as { analystTriggers: Array<{ id: string }> };

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
  it("a template's note is not a note: stamped DEFAULT, or a template's words at any number, whoever the row says set it (CEG 09-30)", () => {
    // CEG's own rules (two older template rows carry no source) and the analyst's rules it still had on 10-28, whose earlier words are stored as set by hand.
    const stillOn = new Set(gev.analystTriggers.map((t) => t.id));
    for (const t of [...ceg.thesisBefore.triggers, ...ceg.analyst.triggers.filter((r) => stillOn.has(r.id))]) expect(writtenNote(t)).toBeNull();
    expect(ceg.analyst.triggers.filter((t) => t.source === "PRINCIPAL" && t.rationale?.includes("DAV-279"))).toHaveLength(2);
    expect(writtenNote({ rationale: "Look at this every 7 days, counting from the last real review." })).toBeNull();
    expect(writtenNote({ rationale: "I buy when it breaks above $331.00.", source: "AGENT" })).toBeNull();
  });
  it("the notes the analyst wrote on CEG's floor and target are kept (10-08)", () => {
    const written = closeOut.CEG.thesis.triggers.filter((t) => t.source === "AGENT");
    expect(written).toHaveLength(2);
    for (const t of written) expect(writtenNote(t)).toBe(t.rationale);
  });
});
