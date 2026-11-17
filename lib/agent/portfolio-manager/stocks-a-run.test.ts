import { STOCKS_A_RUN, managerPick } from "./stocks-a-run";
import { rowForModel } from "@/lib/agent/row-for-model";
import { watchingText, buildSnapshot, snapshotText } from "@/lib/portfolio/snapshot";

const names = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `T${from + i}`);

describe("the Portfolio Manager's get_theses", () => {
  it("needs tickers: the whole account is not returned", () => {
    expect(managerPick({}, {}).refused).toMatch(/Name the stocks by ticker/);
  });

  it("returns a limited number of stocks a run, whatever is asked", () => {
    const ctx = {};
    const first = managerPick(ctx, { tickers: names(40) });
    expect(first.tickers).toHaveLength(STOCKS_A_RUN);
    expect(first.note).toMatch(new RegExp(`Not returned: T${STOCKS_A_RUN}`));
    // A later call gets no new stock; one already asked about comes back again.
    expect(managerPick(ctx, { tickers: names(5, 20) }).refused).toBeTruthy();
    expect(managerPick(ctx, { tickers: ["t0"] }).tickers).toEqual(["T0"]);
  });

  it("gets a holding with a sale's fields and a watch with a buy's, by the shared field rules", () => {
    const row = {
      ticker: "NVDA", id: "th1", coreBelief: "Demand outruns supply.", invalidationConds: ["Orders fall"], keyAssumptions: ["Supply stays short"],
      bullCase: { bullets: [{ text: "bull" }] }, bearCase: { bullets: [{ text: "bear" }] }, variantView: "The Street is late.", triggers: [{ id: "t1", says: "Sell if below $150" }],
    };
    const held = rowForModel({ ...row, status: "HOLDING" }, { named: false, size: "short", fieldsOf: ["PROTECTIVE_SALE"] }) as Record<string, unknown>;
    expect(held.would_prove_it_wrong).toEqual(["Orders fall"]);
    expect(held.triggers).toEqual(["Sell if below $150 [id t1]"]);
    for (const k of ["bull_case", "bear_case", "assumptions", "variant_view"]) expect(held[k]).toBeUndefined();
    const watch = rowForModel({ ...row, status: "WATCHING" }, { named: false, size: "short", fieldsOf: ["BUY_ARRIVES"] }) as Record<string, unknown>;
    expect(watch.variant_view).toBe("The Street is late.");
    for (const k of ["bull_case", "bear_case", "would_prove_it_wrong"]) expect(watch[k]).toBeUndefined();
  });
});

describe("the snapshot's holdings and the Watching block", () => {
  const snap = buildSnapshot({
    day: "2026-11-17", live: false, at: "2026-11-17T21:00:00Z", cash: 1000, contributed: 2000, trades: [],
    holdings: [{ ticker: "V", shares: 2, avgCost: 400, price: 420, prevClose: 410, analyst: "Secular Compounder", move5dPct: -0.9, move20dPct: 3.1, conviction: "HIGH" }],
    waiting: [{ side: "BUY", ticker: "WST", shares: 18, firstProposed: "2026-11-09T15:00:00Z", times: 4, note: null, analyst: "Secular Compounder" }],
    watching: [
      { ticker: "WST", price: 415.37, dayPct: -0.6, move5dPct: 0.7, move20dPct: 6.8, conviction: "HIGH", analyst: "Secular Compounder", since: "2026-08-12T14:00:00Z" },
      { ticker: "ACN", price: null, dayPct: null, move5dPct: null, move20dPct: null, conviction: null, analyst: null, since: "2026-11-17T14:00:00Z" },
    ],
  });

  it("a holding's line carries its 5- and 20-day moves and its conviction", () => {
    expect(snapshotText(snap)).toContain("since bought at $400.00: +5.0% (+$40) · 5-day −0.9%, 20-day +3.1% · conviction HIGH · Secular Compounder");
  });

  it("a holding loaded without them reads as it did", () => {
    const plain = buildSnapshot({ day: "2026-11-17", live: false, at: "2026-11-17T21:00:00Z", cash: 0, contributed: null, trades: [], waiting: [], holdings: [{ ticker: "V", shares: 2, avgCost: 400, price: 420, prevClose: 410, analyst: null }] });
    expect(snapshotText(plain)).toMatch(/since bought at \$400\.00: \+5\.0% \(\+\$40\)$/m);
  });

  it("a watch is one line in the same style, and says when a buy proposal waits", () => {
    expect(watchingText(snap)).toBe(
      ["Watching (2):", "- WST: $415.37 · day −0.6% · 5-day +0.7%, 20-day +6.8% · conviction HIGH · Secular Compounder · watching since Aug 12 · a buy proposal is waiting", "- ACN: no price · watching since Nov 17"].join("\n"),
    );
  });
});
