/**
 * The Street feed's parser and words, read from Nasdaq's real replies for MSFT
 * and SMMT (recorded 2026-11-02). A missing key or a stock with no coverage
 * raises, so the store writes nothing.
 */
import msft from "./__fixtures__/nasdaq-street-MSFT-2026-11-02.json";
import smmt from "./__fixtures__/nasdaq-street-SMMT-2026-11-02.json";
import { epsDetail, parseStreet, streetLine, type StreetResponses } from "@/lib/market-data/street-consensus";
import { rowForModel } from "@/lib/agent/row-for-model";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe("parseStreet", () => {
  it("builds MSFT's row from the three replies", () => {
    expect(parseStreet("msft", msft, "2026-11-02")).toEqual({
      ticker: "MSFT",
      asOf: "2026-11-02",
      targetLow: 440,
      targetAvg: 634.08,
      targetHigh: 750,
      analysts: 38,
      buy: 35,
      hold: 3,
      sell: 0,
      epsNextQuarter: 4.85,
      epsNextQuarterEstimates: 15,
      epsNextQuarterUp: 6,
      epsNextQuarterDown: 3,
      epsNextQuarterFiscalEnd: "Dec 2026",
      epsFiscalYear: 19.79,
      epsFiscalYearUp: 9,
      epsFiscalYearDown: 3,
      epsNextQuarter1wAgo: 4.84,
      epsNextQuarter1mAgo: 4.83,
    });
  });

  it("builds SMMT's row, losses and all", () => {
    expect(parseStreet("SMMT", smmt, "2026-11-02")).toMatchObject({
      targetLow: 11.9,
      targetAvg: 27.49,
      targetHigh: 43,
      analysts: 13,
      epsNextQuarter: -0.28,
      epsNextQuarterEstimates: 3,
      epsNextQuarterFiscalEnd: "Sep 2026",
      epsFiscalYear: -1.2,
    });
  });

  it("a missing key raises", () => {
    const moved = clone(msft);
    delete (moved.targetprice.data.consensusOverview as Partial<typeof moved.targetprice.data.consensusOverview>).priceTarget;
    expect(() => parseStreet("MSFT", moved, "2026-11-02")).toThrow("nasdaq targetprice: no priceTarget");
    const noRows = clone(msft) as unknown as { "earnings-forecast": { data: { quarterlyForecast: Record<string, unknown> } } };
    delete noRows["earnings-forecast"].data.quarterlyForecast.rows;
    expect(() => parseStreet("MSFT", noRows as unknown as StreetResponses, "2026-11-02")).toThrow("no data.quarterlyForecast.rows");
  });

  it("a stock with no coverage, or none counted, raises: never a row of zeros", () => {
    // SPY's reply on 2026-11-02.
    const none = { data: null, message: null, status: { rCode: 200, bCodeMessage: [{ code: 1002, errorMessage: "No record found." }] } };
    expect(() => parseStreet("SPY", { ...msft, targetprice: none }, "2026-11-02")).toThrow("no data.consensusOverview");
    const zeros = clone(msft);
    Object.assign(zeros.targetprice.data.consensusOverview, { buy: 0, hold: 0, sell: 0, priceTarget: 0 });
    expect(() => parseStreet("MSFT", zeros, "2026-11-02")).toThrow("no analysts or no target");
  });

  it("no estimates leave the EPS empty and keep the targets", () => {
    const r = clone(msft) as unknown as StreetResponses & { "earnings-forecast": { data: Record<string, unknown> } };
    r["earnings-forecast"].data.quarterlyForecast = null;
    const row = parseStreet("MSFT", { ...r, "estimate-momentum": { data: null } }, "2026-11-02");
    expect(row).toMatchObject({ targetAvg: 634.08, epsNextQuarter: null, epsNextQuarter1wAgo: null, epsFiscalYear: 19.79 });
  });
});

describe("the words", () => {
  it("the row builder prints the Street line from a row with street set", () => {
    const street = parseStreet("MSFT", msft, "2026-11-02");
    const out = rowForModel({ id: "t_msft", ticker: "MSFT", status: "WATCHING", direction: "LONG", street }, { named: false, size: "short" }) as Record<string, unknown>;
    expect(out.street).toBe("35 buy / 3 hold / 0 sell · targets $440–$750, avg $634 (as of 11-02) · next-quarter EPS $4.85, 6 up / 3 down in 4 weeks");
    expect(streetLine({ street: parseStreet("SMMT", smmt, "2026-11-02") })).toBe(
      "8 buy / 5 hold / 0 sell · targets $11.90–$43.00, avg $27.49 (as of 11-02) · next-quarter EPS -$0.28, 0 up / 0 down in 4 weeks",
    );
    // BBIO on 2026-11-02: one format across the range.
    expect(streetLine({ street: { ...street, targetLow: 88, targetHigh: 156, targetAvg: 110.12 } })).toContain("targets $88–$156, avg $110");
    expect(streetLine({ street: null })).toBeNull();
  });

  it("the EPS consensus in full", () => {
    expect(epsDetail(parseStreet("MSFT", msft, "2026-11-02"))).toBe(
      "next-quarter EPS $4.85, 6 up / 3 down in 4 weeks (quarter ending Dec 2026, 15 estimates; was $4.84 a week ago, $4.83 a month ago) · fiscal-year EPS $19.79, 9 up / 3 down",
    );
  });
});
