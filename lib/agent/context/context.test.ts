/**
 * Context read one way: one loader per fact, keyed to the run's subject
 * (./bundles.ts). Every record reads inside its subject's bundle; a thesis
 * brings its own playbook only; the analyst's room comes where a buy is a
 * choice; the analyst's book is its get_theses read as the model is handed
 * it, and a stock's row and situations are one read.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));
import { prismaDouble, positionRow, agentConfigRow, thesisRow, REPLAY_ACCOUNT_ID, REPLAY_ANALYST_ID } from "@/lib/replay";
import { AGENTS } from "@/lib/agent/engine/agents";
import { BUNDLES, type SubjectKind } from "./bundles";
import type { ContextRun } from "./fact";

const NOW = new Date("2026-11-18T14:00:00Z");
const IN_BOOK = { userId: "user_1", accountId: REPLAY_ACCOUNT_ID, environment: "PAPER" as const };
const thesisRun = (ticker: string, thesisId: string | null, toolset?: ContextRun["toolset"]): ContextRun => ({
  subject: { kind: "thesis", ...IN_BOOK, analystId: REPLAY_ANALYST_ID, ticker, thesisId },
  now: NOW,
  agent: "trigger_run",
  toolset,
});

type Context = typeof import("./index");
async function withDb<T>(seed: Parameters<typeof prismaDouble>[0], fn: (c: Context) => Promise<T>): Promise<T> {
  const db = prismaDouble(seed);
  let out: T | undefined;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    out = await fn(await import("./index"));
  });
  jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
  return out as T;
}

const analyst = agentConfigRow({ id: REPLAY_ANALYST_ID, name: "Case Analyst", setupIds: ["PEAD", "MA_PULLBACK"], maxOpenPositions: 4 });

describe("every record reads inside its subject's bundle", () => {
  it.each(AGENTS.map((r) => [r.id, r] as const))("%s", async (_id, r) => {
    expect(await withDb({}, async ({ outsideItsBundle }) => outsideItsBundle(r))).toEqual([]);
  });

  it("every fact has a loader for exactly the subjects whose bundle has it", async () => {
    const { FACTS, PIECES } = await withDb({}, async (c) => c);
    for (const kind of Object.keys(BUNDLES) as SubjectKind[]) {
      const loaded = Object.entries(FACTS).filter(([, f]) => f[kind]).map(([id]) => id);
      expect([kind, [...loaded].sort()]).toEqual([kind, BUNDLES[kind].filter((id) => !PIECES.includes(id)).sort()]);
    }
  });

  it("refuses a run about another subject", async () => {
    const { loadContext } = await withDb({}, async (c) => c);
    const trigger = AGENTS.find((r) => r.id === "trigger_run")!;
    await expect(loadContext(trigger, { subject: { kind: "account", ...IN_BOOK }, now: NOW, agent: "trigger_run" })).rejects.toThrow("trigger_run is about thesis, and its run is about account");
  });
});

describe("a thesis brings its own playbook, and its analyst's to pick from", () => {
  const seed = { agentConfig: [analyst], thesis: [thesisRow({ id: "t1", ticker: "NVDA", setupId: "PEAD", status: "HOLDING" })] };

  it("the stock's playbook: its own only", async () => {
    const text = await withDb(seed, async ({ FACTS }) => FACTS.the_playbook.thesis!(thesisRun("NVDA", "t1") as never));
    expect(text).toContain("YOUR PLAYBOOKS");
    expect(text).toContain("Post-earnings drift");
    expect(text).not.toContain("Pullback to a rising moving average");
  });

  it("a stock with none yet: each of its analyst's", async () => {
    const text = await withDb({ agentConfig: [analyst] }, async ({ FACTS }) => FACTS.the_playbook.thesis!(thesisRun("AAON", null) as never));
    expect(text).toContain("Post-earnings drift");
    expect(text).toContain("Pullback to a rising moving average");
  });

  it("the analyst's playbooks, which the Writer picks from: every one, whatever the stock's", async () => {
    const text = await withDb(seed, async ({ FACTS }) => FACTS.playbooks.thesis!(thesisRun("NVDA", "t1") as never));
    expect(text).toContain("Post-earnings drift");
    expect(text).toContain("Pullback to a rising moving average");
  });
});

describe("the analyst's room, where a buy is one of the choices", () => {
  const seed = {
    agentConfig: [analyst],
    position: [positionRow({ id: "p1", analystId: REPLAY_ANALYST_ID, symbol: "NVDA", status: "OPEN" })],
  };

  it("on a stock it doesn't hold", async () => {
    const text = await withDb(seed, async ({ FACTS }) => FACTS.the_analyst.thesis!(thesisRun("WST", "t2") as never));
    expect(text).toContain("Positions: 1 of 4 — 3 free.");
  });

  it("not on a stock it holds: an add takes no new slot", async () => {
    const text = await withDb(seed, async ({ FACTS }) => FACTS.the_analyst.thesis!(thesisRun("NVDA", "t1") as never));
    expect(text).not.toContain("Positions:");
  });
});

describe("reads through the run's own tools", () => {
  it("the analyst's book is its get_theses read, as the model is handed it", async () => {
    const asked: unknown[] = [];
    const toolset = {
      get_theses: {
        execute: async (input: unknown) => (asked.push(input), { ok: true, ui: "thesis-card", summary: "2 theses (1 active, 1 watching)", data: { raw: true } }),
        toModelOutput: () => ({ type: "json", value: { ok: true, summary: "2 theses (1 active, 1 watching)", data: { theses: [{ ticker: "NVDA" }], quiet_theses: ["WST · watching"] } } }),
      },
    } as unknown as ContextRun["toolset"];
    const text = await withDb({}, async ({ FACTS }) =>
      FACTS.the_book.analyst!({ subject: { kind: "analyst", ...IN_BOOK, analystId: REPLAY_ANALYST_ID }, now: NOW, agent: "morning_run", toolset } as never),
    );
    expect(asked).toEqual([{}]);
    expect(text).toBe('## Your book (get_theses)\n2 theses (1 active, 1 watching)\n\n{"theses":[{"ticker":"NVDA"}],"quiet_theses":["WST · watching"]}');
  });

  it("a stock's row and its situations are one read", async () => {
    let reads = 0;
    const row = { id: "t1", ticker: "NVDA", status: "HOLDING", direction: "LONG", situations: ["PROTECTIVE_SALE"], triggers: [] };
    const toolset = { get_theses: { execute: async () => (reads++, { ok: true, data: { theses: [row] } }) } } as unknown as ContextRun["toolset"];
    const run = thesisRun("NVDA", "t1", toolset);
    const [stock, situations] = await withDb({}, async ({ FACTS }) => Promise.all([FACTS.the_stock.thesis!(run as never), FACTS.situations.thesis!(run as never)]));
    expect(reads).toBe(1);
    expect(stock).toContain("## $NVDA, its row (get_theses)");
    expect(situations).toContain("## Its situations\nThe situations $NVDA is in (PROTECTIVE_SALE)");
  });
});
