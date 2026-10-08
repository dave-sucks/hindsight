/**
 * The live book after a close (__fixtures__/live-book.json, written by
 * scripts/measure-situations.ts from the real get_theses), every stock's
 * inputs replayed through situationsFor.
 *
 * Each stock gives the list it gave that evening, and every field the list
 * now fills on the row the model reads equals what main's read sent before
 * the list existed: needsAction, nameTheSetup, buyBlockedByFull,
 * heldThroughFloor, resolved.planSanity and resolved.floorRisk. The listing
 * is main's, stock for stock, and so is the thesis sheet's header (the lead's
 * work flag, named). The principal's words in the fixture are replaced on
 * both sides; no rule reads them.
 */
import { readFileSync } from "fs";
import path from "path";
import type { ResolvedEnvelope } from "@/lib/agent/resolved-thesis";
import { listsTheStock, situationsFor, type Situation, type StockInput, type BookInput } from "./index";
import { workFlagLabel, workFlagOf } from "./flag-line";
import { buyBlockedByFullOf, heldThroughFloorOf, nameTheSetupOf, needsActionOf, resolvedForRow } from "./model-row";
import { fromFixtureJson } from "./fixture-json";
import type { WorkFlag } from "./work-flag";

interface FixtureStock {
  ticker: string;
  analyst: string;
  main: {
    needsAction: WorkFlag | null;
    nameTheSetup: unknown;
    buyBlockedByFull: string | null;
    heldThroughFloor: unknown;
    "resolved.planSanity": unknown;
    "resolved.floorRisk": unknown;
    listed: boolean;
  };
  situations: Situation[];
  input: { now: Date; book: BookInput; stock: StockInput } | null;
}
const fixture = fromFixtureJson<{ measuredAt: string; modelFields: string[]; stocks: FixtureStock[] }>(
  readFileSync(path.join(__dirname, "__fixtures__/live-book.json"), "utf8"),
);

/** The resolver's envelope as get_theses holds it; only the two places the list fills are read here. */
const envelope = { currentPrice: null, entryQualityScore: null, unrealizedGainPct: null, progressToTarget: null, ladderHealth: null } as unknown as ResolvedEnvelope;

describe("the live book after a close", () => {
  beforeAll(() => {
    // Research age is counted from the wall clock (staleness.ts).
    jest.useFakeTimers({ now: new Date(fixture.measuredAt) });
  });
  afterAll(() => jest.useRealTimers());

  it("covers the book, and pins six model-facing fields and the listing", () => {
    expect(fixture.stocks.length).toBeGreaterThanOrEqual(30);
    expect(fixture.stocks.every((s) => s.input != null)).toBe(true);
    expect(fixture.modelFields).toEqual(["needsAction", "nameTheSetup", "buyBlockedByFull", "heldThroughFloor", "resolved.planSanity", "resolved.floorRisk", "listed"]);
  });

  it.each(fixture.stocks.map((s) => [`${s.ticker} (${s.analyst})`, s] as const))("%s: the same list, and main's row", (_name, s) => {
    const { stock, book, now } = s.input!;
    const list = situationsFor(stock, book, now);
    expect(list).toEqual(s.situations);

    // The row the model reads, field by field, against main's.
    expect(needsActionOf(list)).toEqual(s.main.needsAction);
    expect(nameTheSetupOf(list)).toEqual(s.main.nameTheSetup);
    expect(buyBlockedByFullOf(list)).toEqual(s.main.buyBlockedByFull);
    expect(heldThroughFloorOf(list, stock.work.latestQuote?.price ?? null)).toEqual(s.main.heldThroughFloor);
    const resolved = resolvedForRow(envelope, list);
    expect(resolved.planSanity).toEqual(s.main["resolved.planSanity"]);
    expect(resolved.floorRisk).toEqual(s.main["resolved.floorRisk"]);

    // Listed exactly when main listed it.
    expect(listsTheStock(list)).toBe(s.main.listed);

    // The thesis sheet's header: the lead's work flag, named as main named it.
    const lead = workFlagOf(list);
    expect(lead ? workFlagLabel(lead) : null).toEqual(s.main.needsAction ? workFlagLabel(s.main.needsAction) : null);
  });
});
