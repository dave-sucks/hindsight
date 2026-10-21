/**
 * The research brief, replayed from IOT in October 2026 through the real
 * entry points: closeOpenPosition (the Oct 16 floor-sale proposal, staged by
 * the no-agent close path) and close_position (the Oct 19 agent proposal).
 * Only the edges are doubled — the database, Sonar, xAI, Finnhub, the
 * synthesis model, Alpaca and the mailer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prismaDouble, replayTool, thesisRow, type PrismaDouble, type Row } from "@/lib/replay";

const fx = JSON.parse(readFileSync(join(__dirname, "__fixtures__/iot-2026-10.json"), "utf8"));
const { account, position, thesis } = fx.rows;
// Modules and rows loaded inside the isolated scope are read loosely; the assertions pin the shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

const SYNTH = "Samsara fell with software on Oct 16, not on company news; Wall Street stays mostly bullish.";

interface Vendors {
  sonar?: "ok" | "fail";
  xai?: "ok" | "fail" | Promise<void>;
  /** The day the proposal was staged, for the price and the day's move. */
  day?: "oct16" | "oct19";
}

const seed = (over: Record<string, Row[]> = {}) => ({
  account: [{ ...account }],
  position: [{ ...position, userId: "user_replay", openedAt: new Date(position.openedAt) }],
  thesis: [thesisRow({ ...thesis, analystId: position.analystId, accountId: account.id })],
  ...over,
});

const MOCKED = [
  "@/lib/prisma", "@/lib/inngest/client", "@/lib/agent/research-helpers", "@/lib/market-data/live-quote", "@/lib/alpaca",
  "@/lib/proposals/exit-quote", "@/lib/actions/api-keys.actions", "@/lib/email", "@/lib/emails/recipients", "ai",
];

/** The database joins an order to its position; the double carries relations inline, so link on create. */
function linked(db: PrismaDouble): PrismaDouble {
  const orders = db.order as { create: (a: unknown) => Promise<unknown> };
  const create = orders.create;
  orders.create = async (a) => {
    const out = await create(a);
    const row = db.store.order.at(-1)!;
    row.position = db.store.position.find((p) => p.id === row.positionId);
    return out;
  };
  return db;
}

/** Run `fn` with the edges doubled over `db`, loading the real modules fresh. */
async function inScope<T>(db: PrismaDouble, v: Vendors, fn: (m: Loose) => Promise<T>) {
  const send = jest.fn<Promise<undefined>, [unknown]>(async () => undefined);
  const sendEmail = jest.fn<Promise<object>, [{ html: string }]>(async () => ({}));
  const prompts: string[] = [];
  const hosts: string[] = [];
  const day = fx.rows[v.day ?? "oct16"];
  const realFetch = global.fetch;
  process.env.XAI_API_KEY = "test";
  global.fetch = jest.fn(async (url: string) => {
    const host = new URL(url).hostname;
    hosts.push(host);
    if (host === "api.perplexity.ai") return v.sonar === "fail" ? new Response("down", { status: 503 }) : Response.json(fx.sonar);
    if (host === "api.x.ai") {
      if (v.xai === "fail") throw new Error("socket hang up");
      if (v.xai instanceof Promise) await v.xai;
      return Response.json(fx.xai);
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;

  let out!: T;
  try {
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/prisma", () => ({ prisma: db }));
      jest.doMock("@/lib/inngest/client", () => ({
        inngest: { createFunction: jest.fn((cfg: unknown) => ({ cfg })), send },
      }));
      jest.doMock("@/lib/agent/research-helpers", () => ({
        ...jest.requireActual("@/lib/agent/research-helpers"),
        finnhub: jest.fn(async (path: string) =>
          path.startsWith("/stock/profile2") ? { data: fx.finnhub.profile2 }
          : path.startsWith("/stock/recommendation") ? { data: fx.finnhub.recommendation }
          : { data: null, error: "replay: no vendor" }),
      }));
      jest.doMock("@/lib/market-data/live-quote", () => ({
        getLiveQuotes: jest.fn(async () => ({
          IOT: { quote: { c: day.price, dp: day.price / 42 * 100 - 100 } },
          SPY: { quote: { c: 600, dp: day.spy } },
          XLK: { quote: { c: 250, dp: day.sector } },
        })),
      }));
      jest.doMock("@/lib/alpaca", () => ({
        getAccount: jest.fn(async () => ({ equity: "110000" })),
        getLatestPrice: jest.fn(async () => day.price),
        placeMarketOrder: jest.fn(async () => ({ id: "alpaca_sale" })),
        getOrder: jest.fn(async () => ({ status: "filled", filled_avg_price: String(day.price), filled_at: new Date().toISOString() })),
      }));
      jest.doMock("@/lib/proposals/exit-quote", () => ({ getLiveExitPrice: jest.fn(async () => day.price) }));
      jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: jest.fn(async () => null) }));
      jest.doMock("@/lib/email", () => ({ sendEmail }));
      jest.doMock("@/lib/emails/recipients", () => ({ getEmailRecipients: jest.fn(async () => ["owner@example.test"]) }));
      jest.doMock("ai", () => ({
        ...jest.requireActual("ai"),
        generateText: jest.fn(async ({ prompt }: { prompt: string }) => {
          prompts.push(prompt);
          return { text: SYNTH, usage: { inputTokens: 1500, outputTokens: 220 } };
        }),
      }));
      const m = {
        ...(await import("@/lib/actions/closeTrade.actions")),
        ...(await import("@/lib/inngest/functions/research-brief")),
        ...(await import("@/lib/research/brief")),
      };
      out = await fn(m);
      // Let fire-and-forget sends settle inside the scope.
      await new Promise((r) => setTimeout(r, 20));
    });
  } finally {
    global.fetch = realFetch;
    // doMock outlives the isolated registry; undo it so the next load sees the real modules.
    for (const path of MOCKED) jest.dontMock(path);
  }
  return { out, send, sendEmail, prompts, hosts };
}

/** Inngest's step, played straight: invoke builds the brief, or times out. */
const fakeStep = (m: Loose, invoke: "build" | "timeout" = "build") => ({
  run: async <T,>(_id: string, f: () => Promise<T>) => f(),
  invoke: async (_id: string, o: { data: { orderId: string; kind: string } }) => {
    if (invoke === "timeout") throw new Error("Timed out waiting for the invoked function");
    return m.briefForOrder(o.data.orderId, o.data.kind);
  },
});

/** For a store built inside replayTool: link its newest order to the position. */
function linkOrder(db: PrismaDouble): Row {
  const order = db.store.order.at(-1)!;
  order.position = db.store.position.find((p) => p.id === order.positionId);
  return order;
}

const sentNames = (send: jest.Mock) => send.mock.calls.map((c) => (c[0] as { name: string }).name);

describe("IOT 2026-10-16 — the floor-sale proposal comes with a research brief", () => {
  it("stages the proposal, builds the brief, attaches it to the order, and the email carries it", async () => {
    const db = linked(prismaDouble(seed()));
    const staged = await inScope(db, {}, (m) =>
      m.closeOpenPosition(position.id, "STOP", undefined, "price_monitor", "Below the floor.", "run_oct16"),
    );
    expect((staged.out as Loose).kind).toBe("proposed");
    const order = db.store.order.at(-1)!;
    expect(staged.send).toHaveBeenCalledWith({ name: "app/proposal.pending", id: `proposal-pending-${order.id}`, data: { orderId: order.id } });
    expect(staged.sendEmail).not.toHaveBeenCalled(); // the email waits for the brief

    const emailed = await inScope(db, {}, (m) => m.proposalEmailSteps(order.id, fakeStep(m)));
    expect(emailed.out).toEqual({ briefOnTime: true });

    const [brief] = db.store.researchBrief as Row[];
    expect(brief).toMatchObject({ orderId: order.id, ticker: "IOT", kind: "PROPOSAL", error: null, reusedFromId: null });
    const p = brief.payload as Loose;
    // The claim citing a page Sonar never read, and the undated upgrade, are gone.
    expect(p.whyItMoved.map((c: { text: string }) => c.text)).toEqual([
      "Software names sold off on Oct 16 on rate worries; the drop was sector-wide, not about Samsara.",
      "Two founders sold shares under pre-set trading plans the same week.",
    ]);
    expect(p.analystActions.map((a: { firm: string }) => a.firm)).toEqual(["Firm A", "Firm B"]);
    expect(p.targets).toMatchObject({ average: 52, low: 46, lowFirm: "Firm D", high: 58, highFirm: "Firm B" });
    expect(p.ratings).toMatchObject({ strongBuy: 4, buy: 6, hold: 4, sell: 0 });
    // X: spam, the other ticker and the uncited link are dropped; mostly spam is said.
    expect(p.social.posts.map((x: { handle: string }) => x.handle)).toEqual(["user1", "user2", "user3"]);
    expect(p.social.mostlySpam).toBe(true);
    expect(p.numbers.position).toMatchObject({ occasion: "Proposed sale of all 300 shares", shares: 300, stop: 41.42, target: 47 });
    expect(p.synthesis).toBe(SYNTH);
    expect(brief.costs).toMatchObject({ webUsd: 0.0084, xUsd: 0.13 });

    // The synthesis read the facts, never the dropped claim.
    expect(emailed.prompts[0]).toContain("Proposed sale of all 300 shares");
    expect(emailed.prompts[0]).not.toContain("never read");

    expect(emailed.sendEmail).toHaveBeenCalledTimes(1);
    const html = emailed.sendEmail.mock.calls[0][0].html;
    expect(html).toContain("Research brief");
    expect(html).toContain(SYNTH);
    expect(html).toContain("news.example.com");
    expect(html).toContain("10 buy · 4 hold · 0 sell");
  });
});

describe("IOT 2026-10-19 — the agent's sale proposal through close_position", () => {
  it("the proposal from the tool gets its brief and the email carries it", async () => {
    const send = jest.fn<Promise<undefined>, [unknown]>(async () => undefined);
    const { db, refused } = await replayTool("close-position", "closePosition", {
      seed: seed(),
      args: { ticker: "IOT", reason: "STOP", notes: "Selling IOT below the floor.", belief_survived: true },
      ctx: { analystId: position.analystId, accountId: account.id, runMode: "INTRADAY_TACTICAL", runEnvironment: "LIVE" },
      quotes: { IOT: fx.rows.oct19.price },
      mocks: { "@/lib/inngest/client": () => ({ inngest: { createFunction: jest.fn(() => ({})), send } }) },
    });
    expect(refused).toBe(false);
    const order = linkOrder(db);
    expect(order).toMatchObject({ status: "AWAITING_APPROVAL", intent: "CLOSE", closeSource: "agent" });
    await new Promise((r) => setTimeout(r, 20));
    expect(sentNames(send)).toContain("app/proposal.pending");

    const emailed = await inScope(db, { day: "oct19" }, (m) => m.proposalEmailSteps(order.id, fakeStep(m)));
    expect(emailed.out).toEqual({ briefOnTime: true });
    expect((db.store.researchBrief as Row[])[0]).toMatchObject({ orderId: order.id, kind: "PROPOSAL" });
    expect(emailed.sendEmail.mock.calls[0][0].html).toContain(SYNTH);
  });
});

describe("a vendor failure never costs the email", () => {
  it("Sonar down and X unreachable: the email still goes, and the brief says what failed", async () => {
    const db = linked(prismaDouble(seed()));
    await inScope(db, {}, (m) => m.closeOpenPosition(position.id, "STOP", undefined, "price_monitor", "Below the floor.", "run_x"));
    const order = db.store.order.at(-1)!;
    const emailed = await inScope(db, { sonar: "fail", xai: "fail" }, (m) => m.proposalEmailSteps(order.id, fakeStep(m)));

    const brief = (db.store.researchBrief as Row[])[0];
    const p = brief.payload as Loose;
    expect(p.failures.map((f: { part: string }) => f.part)).toEqual(["web", "x"]);
    expect(brief.error).toContain("Sonar HTTP 503");
    expect(p.whyItMoved).toEqual([]);
    expect(p.ratings).not.toBeNull(); // Finnhub still answered
    const html = emailed.sendEmail.mock.calls[0][0].html;
    expect(html).toContain("Web research failed: Sonar HTTP 503");
    expect(html).toContain("X search failed: socket hang up");
    expect(html).toContain("No company news found");
  });

  it("the brief not ready in 30s: the email goes without it", async () => {
    const db = linked(prismaDouble(seed()));
    await inScope(db, {}, (m) => m.closeOpenPosition(position.id, "STOP", undefined, "price_monitor", "Below the floor.", "run_x"));
    const order = db.store.order.at(-1)!;
    const emailed = await inScope(db, {}, (m) => m.proposalEmailSteps(order.id, fakeStep(m, "timeout")));
    expect(emailed.out).toEqual({ briefOnTime: false });
    expect(emailed.sendEmail).toHaveBeenCalledTimes(1);
    expect(emailed.sendEmail.mock.calls[0][0].html).not.toContain("Research brief");
  });

  it("Inngest refuses the event: the email is sent straight away, without a brief", async () => {
    const db = linked(prismaDouble(seed()));
    const run = await inScope(db, {}, async (m) => {
      const { inngest } = await import("@/lib/inngest/client");
      (inngest.send as jest.Mock).mockRejectedValueOnce(new Error("no event key"));
      return m.closeOpenPosition(position.id, "STOP", undefined, "price_monitor", "Below the floor.", "run_x");
    });
    expect((run.out as Loose).kind).toBe("proposed");
    expect(run.send).toHaveBeenCalledTimes(1);
    expect(run.sendEmail).toHaveBeenCalledTimes(1);
    expect(run.sendEmail.mock.calls[0][0].html).not.toContain("Research brief");
  });
});

describe("X is the slow one", () => {
  it("the brief is saved without X first, so the email has it, then completed", async () => {
    const db = linked(prismaDouble(seed()));
    await inScope(db, {}, (m) => m.closeOpenPosition(position.id, "STOP", undefined, "price_monitor", "Below the floor.", "run_x"));
    const order = db.store.order.at(-1)!;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const run = inScope(db, { xai: gate }, async (m) => {
      const building = m.briefForOrder(order.id, "PROPOSAL");
      while (!(db.store.researchBrief as Row[]).length) await new Promise((r) => setTimeout(r, 5));
      const partial = structuredClone((db.store.researchBrief as Row[])[0].payload) as Loose;
      release();
      await building;
      return partial;
    });
    const { out: partial, prompts } = await run;
    expect(partial.social.status).toBe("loading");
    expect(partial.whyItMoved).toHaveLength(2);
    expect(partial.synthesis).toBe(SYNTH);
    const done = (db.store.researchBrief as Row[])[0].payload as Loose;
    expect(db.store.researchBrief).toHaveLength(1);
    expect(done.social.status).toBe("ok");
    expect(prompts).toHaveLength(2); // rewritten once X is in
  });
});

describe("a brief under two hours old is reused", () => {
  const orderRow = (id: string, createdAt: string) => ({
    id, positionId: position.id, userId: "user_replay", symbol: "IOT", side: "SELL", status: "AWAITING_APPROVAL",
    intent: "CLOSE", quantity: 300, thesisId: thesis.id, createdAt: new Date(createdAt),
    position: { ...position, userId: "user_replay" },
  });

  it("the paid research is not bought twice within two hours; it is after", async () => {
    const db = linked(prismaDouble(seed({ order: [orderRow("o1", "2026-10-16T14:10:00Z"), orderRow("o2", "2026-10-16T15:40:00Z"), orderRow("o3", "2026-10-16T16:15:00Z")] })));
    const t0 = new Date("2026-10-16T14:10:30Z");
    const first = await inScope(db, {}, (m) => m.briefForOrder("o1", "PROPOSAL", t0));
    expect(first.hosts.filter((h) => h !== "api.x.ai")).toEqual(["api.perplexity.ai"]);

    const second = await inScope(db, {}, (m) => m.briefForOrder("o2", "PROPOSAL", new Date(t0.getTime() + 90 * 60_000)));
    expect(second.out).toMatchObject({ reused: true });
    expect(second.hosts).toEqual([]); // no Sonar, no X
    const rows = db.store.researchBrief as Row[];
    expect(rows[1]).toMatchObject({ orderId: "o2", reusedFromId: rows[0].id });
    expect(rows[1].costs).toMatchObject({ webUsd: 0, xUsd: 0 });
    expect((rows[1].payload as Loose).whyItMoved).toEqual((rows[0].payload as Loose).whyItMoved);
    expect(second.prompts).toHaveLength(1); // the read about THIS order is rewritten

    const third = await inScope(db, {}, (m) => m.briefForOrder("o3", "PROPOSAL", new Date(t0.getTime() + 125 * 60_000)));
    expect(third.out).toMatchObject({ reused: false });
    expect(third.hosts).toContain("api.perplexity.ai");
  });
});

describe("a sale sent without asking still gets its brief", () => {
  it("an autonomous sale asks for a SALE brief; a sale by hand does not", async () => {
    const off = { ...account, requireApprovalSellsLive: false };
    const db = linked(prismaDouble(seed({ account: [off] })));
    const auto = await inScope(db, {}, (m) => m.closeOpenPosition(position.id, "STOP", undefined, "price_monitor", "Below the floor.", "run_s"));
    expect((auto.out as Loose).kind).toBe("closed");
    const order = db.store.order.at(-1)!;
    expect(auto.send).toHaveBeenCalledWith({
      name: "app/research.brief.requested",
      id: `research-brief-${order.id}`,
      data: { orderId: order.id, ticker: "IOT", kind: "SALE" },
    });

    const db2 = linked(prismaDouble(seed({ account: [off] })));
    const byHand = await inScope(db2, {}, (m) => m.closeOpenPosition(position.id, "MANUAL", undefined, "user"));
    expect(sentNames(byHand.send)).not.toContain("app/research.brief.requested");
  });
});
