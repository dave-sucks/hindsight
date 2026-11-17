/**
 * The 2026-11-16 stop-watching migration, as it ran against a local copy of
 * every live thesis taken from production that day
 * (lib/agent/__fixtures__/stop-watching-migration-2026-11-16.json): each sale
 * line on a stock we only watch is stored as the Stop watching line it was,
 * with the "only on the close" timing the check used to add when it read it.
 * Nothing fires differently, and the pill and the dialog read the saved
 * timing: HTFL reads "Stop watching if below $46.50 · only on the close".
 */

import { statSync } from "fs";
import raw from "@/lib/agent/__fixtures__/stop-watching-migration-2026-11-16.json";
import { allowedActions, actionLabel, conditionsOf, pillParts, sentenceOf, settingDefs, shapeOf, triggerLabel, waitsForClose, type Condition } from "./condition";
import { fireModeOf, fireModeProblem, fireModeWords } from "./fire-mode";
import { parseTriggersResilient } from "./schema";
import { resolveLadder } from "./levels";
import type { Trigger } from "./types";

type Line = { id: string; action: string; fireMode?: string; predicate: Record<string, unknown>; rationale?: string };
const fx = raw as unknown as { stocks: Array<{ ticker: string; before: Line[]; after: Line[]; linesBefore: number; linesAfter: number }> };
const FIXTURE = "lib/agent/__fixtures__/stop-watching-migration-2026-11-16.json";
const after = fx.stocks.flatMap((s) => s.after.map((t) => ({ ...t, ticker: s.ticker })));

describe("the nine lines, migrated", () => {
  it("eight watched stocks, nine sale lines before (AAPL's EXIT and DEMOTE), eight Stop watching lines after: AAPL ends with one", () => {
    expect(fx.stocks.map((s) => s.ticker)).toEqual(["AAPL", "EXEL", "GD", "HTFL", "ISRG", "MSFT", "TRV", "WST"]);
    expect(fx.stocks.flatMap((s) => s.before)).toHaveLength(9);
    expect(fx.stocks.flatMap((s) => s.before.map((t) => t.action)).filter((a) => a === "DEMOTE")).toEqual(["DEMOTE"]);
    expect(after.every((t) => t.action === "STOP_WATCHING")).toBe(true);
    const aapl = fx.stocks.find((s) => s.ticker === "AAPL")!;
    expect([aapl.after.length, aapl.linesBefore - aapl.linesAfter]).toEqual([1, 1]);
  });

  it("every line reads through the save's read gate, nothing dropped", () => {
    const read = parseTriggersResilient(after);
    expect([read.triggers.length, read.dropped]).toEqual([8, 0]);
  });

  it("nothing fires differently: the same condition, read on the close as the check read it, and on a watch it stops watching", () => {
    for (const s of fx.stocks) {
      const was = s.before[0];
      const now = s.after[0];
      expect([s.ticker, now.id]).toEqual([s.ticker, was.id]);
      const { settings: _drop, ...plain } = was.predicate as { settings?: unknown };
      void _drop;
      expect([s.ticker, now.predicate]).toEqual([s.ticker, { ...plain, settings: { close: true } }]);
      expect([s.ticker, waitsForClose(shapeOf(now.predicate)!)]).toEqual([s.ticker, true]);
      // A watch keeps it in its ladder (a sale would be dropped there now); a holding would not.
      expect(resolveLadder({ thesis: [now as unknown as Trigger], state: "WATCHING" }).map((t) => t.id)).toEqual([now.id]);
      expect(resolveLadder({ thesis: [now as unknown as Trigger], state: "HELD" })).toEqual([]);
    }
  });

  it("its one On fire choice: MSFT's Auto-sell on a watch, which only ever stopped watching it, is stored as that", () => {
    const msft = fx.stocks.find((s) => s.ticker === "MSFT")!;
    expect(msft.before[0].fireMode).toBe("DO_IT");
    for (const t of after) {
      expect([t.ticker, t.fireMode, fireModeProblem(t.action, fireModeOf(t as never))]).toEqual([t.ticker, "ASK_NOW", null]);
      expect(fireModeWords(t as never)).toBe("Stops watching when it fires");
    }
  });
});

describe("HTFL, in the pill and the dialog", () => {
  const htfl = after.find((t) => t.ticker === "HTFL")! as unknown as Trigger;
  const w = shapeOf(htfl.predicate)!;

  it("the pill: Stop watching if · below · $46.50 · only on the close", () => {
    expect(triggerLabel(htfl)).toBe("Stop watching if");
    expect(pillParts(w).parts).toEqual([{ label: "below", value: "$46.50 · only on the close" }]);
    expect(sentenceOf(htfl)).toBe("Stop watching if below $46.50 · only on the close");
  });

  it("the dialog: its action is offered on a watch and named the same, and its timing field shows the saved Only on the close", () => {
    expect(allowedActions(w, { held: false, standing: false })).toContain("STOP_WATCHING");
    expect(actionLabel(htfl.action)).toBe("Stop watching if");
    const c = conditionsOf(w)[0] as Condition;
    const close = settingDefs(c).find((d) => d.key === "close")!;
    expect(close.options?.find((o) => o.value === c.settings?.close)?.label).toBe("Only on the close");
  });
});

it("the fixture is small", () => {
  expect(statSync(FIXTURE).size).toBeLessThan(10 * 1024);
});
