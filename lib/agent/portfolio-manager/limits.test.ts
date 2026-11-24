jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import type { ToolSet } from "ai";
import { PROPOSALS_A_RUN, WATCHES_A_RUN, managerPick, withRunLimits } from "./limits";
import { rowForModel } from "@/lib/agent/row-for-model";
import { buildSnapshot, snapshotText, firstSentence } from "@/lib/portfolio/snapshot";
import { bookText } from "@/lib/agent/book";

const names = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `T${from + i}`);
const HELD = new Set(["V", "CEG"]);

describe("the Portfolio Manager's get_theses", () => {
  it("needs tickers: the whole account is not returned", () => {
    expect(managerPick({}, {}, HELD).refused).toMatch(/Name the stocks by ticker/);
  });

  it("returns any holding, and a limited number of watched stocks a run", () => {
    const ctx = {};
    const first = managerPick(ctx, { tickers: ["v", "CEG", ...names(40)] }, HELD);
    expect(first.tickers).toEqual(["V", "CEG", ...names(WATCHES_A_RUN)]);
    expect(first.note).toMatch(new RegExp(`Not returned: T${WATCHES_A_RUN}`));
    // A later call gets no new watch; a holding and a watch already asked about come back.
    expect(managerPick(ctx, { tickers: names(5, 20) }, HELD).refused).toBeTruthy();
    expect(managerPick(ctx, { tickers: ["t0", "V"] }, HELD).tickers).toEqual(["T0", "V"]);
  });

  it("gets a holding and a watch with the same fields, the row every agent gets, without the long research", () => {
    const row = {
      ticker: "NVDA", id: "th1", coreBelief: "Demand outruns supply.", invalidationConds: ["Orders fall"], keyAssumptions: ["Supply stays short"], convictionRationale: "Backlog is signed.",
      bullCase: { bullets: [{ text: "bull" }] }, bearCase: { bullets: [{ text: "bear" }] }, variantView: "The Street is late.", snapshot: "A long snapshot.",
      triggers: [{ id: "t1", says: "Sell if below $150" }], latestEarnings: { bullets: [{ text: "Beat." }, { text: "Raised." }, { text: "A third bullet." }] },
      context: "the one list",
    };
    const held = rowForModel({ ...row, status: "HOLDING" }) as Record<string, unknown>;
    const watch = rowForModel({ ...row, status: "WATCHING" }) as Record<string, unknown>;
    expect(Object.keys(held)).toEqual(Object.keys(watch));
    expect(held).toMatchObject({ would_prove_it_wrong: ["Orders fall"], assumptions: ["Supply stays short"], conviction_rationale: "Backlog is signed.", said: "the one list" });
    expect(held.variant_view).toBe("The Street is late.");
    for (const k of ["bull_case", "bear_case", "snapshot", "latestEarnings", "situations"]) expect(held[k]).toBeUndefined();
  });
});

describe("the run's limits, held by its tools", () => {
  const calls: string[] = [];
  const tool = (name: string) => ({ execute: async () => (calls.push(name), { ok: true, summary: "done" }) });
  const tools = () =>
    withRunLimits(Object.fromEntries(["place_trade", "add", "sell", "write_note", "dispatch_thesis_research", "get_theses"].map((n) => [n, tool(n)])) as unknown as ToolSet, async (id) => ({ th_v: "V", th_mu: "MU" })[id] ?? null);
  const call = (t: ToolSet, name: string, input: Record<string, unknown>) => (t[name] as unknown as { execute: (i: unknown, o: unknown) => Promise<{ ok: boolean; error?: string }> }).execute(input, {});

  it(`refuses a proposal after ${PROPOSALS_A_RUN}, across the three trade tools`, async () => {
    const t = tools();
    expect((await call(t, "place_trade", { ticker: "WST" })).ok).toBe(true);
    expect((await call(t, "add", { ticker: "CEG" })).ok).toBe(true);
    expect((await call(t, "sell", { ticker: "NVDA" })).ok).toBe(true);
    const fourth = await call(t, "sell", { ticker: "IOT" });
    expect(fourth).toMatchObject({ ok: false, error: expect.stringContaining("WST, CEG, NVDA") });
  });

  it("a note goes only with a trade or a research request this run made on that stock", async () => {
    const t = tools();
    expect(await call(t, "write_note", { thesis_id: "th_v", note: "Still holding." })).toMatchObject({ ok: false, error: expect.stringContaining("write-up") });
    await call(t, "sell", { ticker: "v" });
    expect((await call(t, "write_note", { thesis_id: "th_v", note: "Why I'd sell." })).ok).toBe(true);
    await call(t, "dispatch_thesis_research", { ticker: "mu", brief: "Its case reads out of date." });
    expect((await call(t, "write_note", { thesis_id: "th_mu", note: "Why it needs research." })).ok).toBe(true);
    expect((await call(t, "write_note", { thesis_id: "th_x", note: "Buy it on the break." })).ok).toBe(false);
  });

  it("a refused trade is not counted", async () => {
    const real = { place_trade: { execute: async () => ({ ok: false, error: "A buy proposal on WST is already awaiting user approval." }) }, write_note: tool("write_note") } as unknown as ToolSet;
    const t = withRunLimits(real, async () => "WST");
    await call(t, "place_trade", { ticker: "WST" });
    expect((await call(t, "write_note", { thesis_id: "th_wst", note: "x" })).ok).toBe(false);
  });
});

describe("the snapshot's holdings and the book", () => {
  const snap = buildSnapshot({
    day: "2026-11-17", live: false, at: "2026-11-17T21:00:00Z", cash: 1000, contributed: 2000, trades: [],
    holdings: [{ ticker: "V", shares: 2, avgCost: 400, price: 420, prevClose: 410, analyst: "Secular Compounder", move5dPct: -0.9, move20dPct: 3.1, conviction: "HIGH" }],
    waiting: [{ side: "BUY", ticker: "WST", shares: 18, firstProposed: "2026-11-09T15:00:00Z", times: 4, note: null, analyst: "Secular Compounder" }],
  });

  it("a holding's line carries its 5- and 20-day moves, and its conviction", () => {
    expect(snapshotText(snap)).toContain("since bought at $400.00: +5.0% (+$40) · 5-day −0.9%, 20-day +3.1% · conviction HIGH · Secular Compounder");
  });

  it("a holding loaded without them reads as it did", () => {
    const plain = buildSnapshot({ day: "2026-11-17", live: false, at: "2026-11-17T21:00:00Z", cash: 0, contributed: null, trades: [], waiting: [], holdings: [{ ticker: "V", shares: 2, avgCost: 400, price: 420, prevClose: 410, analyst: null }] });
    expect(snapshotText(plain)).toMatch(/since bought at \$400\.00: \+5\.0% \(\+\$40\)$/m);
  });

  it("the book: a line a stock with its belief's first sentence, a watch with its buy triggers, a stock held by one analyst and watched by another held", () => {
    expect(
      bookText([
        { ticker: "WST", status: "WATCHING", analyst: "Secular Compounder", belief: "West compounds as its margins recover. More.", buyIf: ["Buy if below $415.14"] },
        { ticker: "ACN", status: "WATCHING", analyst: null, belief: null },
        { ticker: "V", status: "WATCHING", analyst: "PEAD Specialist", belief: "A watch." },
        { ticker: "V", status: "HOLDING", analyst: "Secular Compounder", belief: "Payments keep growing." },
      ]),
    ).toBe(
      [
        "## The book",
        "Holding (1):",
        "- V · Secular Compounder · Payments keep growing.",
        "Watching (2):",
        "- ACN · no belief written",
        "- WST · Secular Compounder · West compounds as its margins recover. · Buy if below $415.14",
      ].join("\n"),
    );
  });

  it("the belief's first sentence is whole", () => {
    expect(firstSentence("Constellation is the largest U.S. nuclear generator, and Inc. filings show it. A second sentence.")).toBe("Constellation is the largest U.S. nuclear generator, and Inc. filings show it.");
  });
});
