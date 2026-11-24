/**
 * The watch rewrite's save step (rewriteOne, scripts/rewrite-watches.ts), end
 * to end on MA's row as production held it on 2026-11-19 (cmum2tf9m000d04jfv0szuiap,
 * MA_PULLBACK, three triggers an agent wrote): the journal, the clear, the
 * playbook's triggers, and the send. Only the edges are doubled (the database,
 * Inngest, the EDGAR read); the trigger ops, their rules and the send are the
 * real code. The first version saved the stamp through update_thesis with no
 * note: the save refused it and the script sent MA to the Writer cleared. The
 * second gave it a note, which is a paragraph the app wrote and counts as a
 * review; the stamp is now a title-only line that leaves the review clock.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Rewritten, Watch } from "./rewrite-watches";
import { prismaDouble, thesisRow, agentConfigRow, accountRow, REPLAY_ANALYST_ID, REPLAY_ACCOUNT_ID, REPLAY_USER_ID, type Row } from "@/lib/replay";
import { playbookTemplates } from "@/lib/agent/knowledge/playbooks";
import { describeTrigger } from "@/lib/agent/triggers/ops";
import type { Trigger } from "@/lib/agent/triggers/types";

const playbooks = (id: string) => playbookTemplates(null, id);
const said = (ts: Trigger[]) => ts.map(describeTrigger);
/** When MA was last reviewed: the stamp must leave it. */
const REVIEWED = new Date("2026-11-06T13:04:00Z");

const MA_CHART = {
  price: 643.37,
  base: { pivot: 681.99, low: 605, depthPct: 11.3, lengthBars: 22, startDate: "2026-10-20", endDate: "2026-11-18", lastContractionPct: 6.7, brokenOut: false },
  gaps: [],
  range: { high20: 681.99, low20: 605, high52w: 681.99, low52w: 464.52, pctBelow52wHigh: 5.7, pctAbove52wLow: 38.5 },
  swings: { lastHigh: { price: 681.99, date: "2026-11-05" }, lastLow: { price: 605, date: "2026-10-28" } },
} as never;
const MA: Watch = {
  thesisId: "cmum2tf9m000d04jfv0szuiap",
  ticker: "MA",
  direction: "LONG",
  setupId: "MA_PULLBACK",
  triggers: [
    { id: "18abc899", action: "REVIEW", source: "AGENT", predicate: { is: "before", value: 3, watch: "report" }, rationale: "Q3 earnings land October 29." },
    { id: "3b6ac96d", action: "ENTER", source: "AGENT", predicate: { is: "near", value: 2, watch: "move", variable: "sma50" }, rationale: "Within 2% of the rising 50-day." },
    { id: "dd1cfbac", action: "REVIEW", source: "AGENT", predicate: { is: "below", value: 10, watch: "move", variable: "close_20d" }, rationale: "A 10%-plus drawdown from the 20-day close." },
  ] as unknown as Trigger[],
};

async function rewrite(playbooks: (id: string) => ReturnType<typeof playbookTemplates>, triggers: unknown[] = MA.triggers) {
  const MA_ROW = thesisRow({ id: MA.thesisId, ticker: "MA", status: "WATCHING", direction: "LONG", setupId: "MA_PULLBACK", analystId: REPLAY_ANALYST_ID, triggers, lastReviewedAt: REVIEWED } as Partial<Row>);
  const db = prismaDouble({ thesis: [MA_ROW], agentConfig: [agentConfigRow({ name: "Secular Compounder" })], account: [accountRow()] });
  const before = JSON.stringify(db.store.thesis.find((t) => t.id === MA.thesisId));
  const send = jest.fn(async () => undefined);
  const journalPath = join(mkdtempSync(join(tmpdir(), "rewrite-")), "journal.jsonl");
  let out!: Rewritten;
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({ inngest: { createFunction: jest.fn(() => ({})), send } }));
    jest.doMock("@/lib/market-data/sec-filings", () => ({ ...jest.requireActual("@/lib/market-data/sec-filings"), fetchBookFilings: async () => ({ byTicker: new Map(), error: null }) }));
    const { rewriteOne, brief } = await import("./rewrite-watches");
    out = await rewriteOne({
      thesisId: MA.thesisId,
      ticker: "MA",
      analyst: { id: REPLAY_ANALYST_ID, name: "Secular Compounder", userId: REPLAY_USER_ID, accountId: REPLAY_ACCOUNT_ID },
      chart: MA_CHART,
      playbooks,
      brief: brief("Secular Compounder", "MA_PULLBACK", []),
      journalPath,
    });
  });
  const stock = db.store.thesis.find((t) => t.id === MA.thesisId)!;
  return {
    out,
    db,
    send,
    journal: existsSync(journalPath) ? readFileSync(journalPath, "utf8") : null,
    triggers: stock.triggers as Trigger[],
    lastReviewedAt: stock.lastReviewedAt,
    rowUnchanged: JSON.stringify(stock) === before,
  };
}

describe("main()'s save step, end to end on MA: journal, clear, the playbook's triggers, send", () => {
  it("MA ends with its playbook's three triggers and goes to the Writer as a refresh", async () => {
    const r = await rewrite(playbooks);
    expect(r.out).toMatchObject({ ok: true, cleared: MA.triggers.map((t) => expect.objectContaining({ id: t.id })) });
    // The journal holds what came off, written before it did.
    expect(JSON.parse(String(r.journal).trim()).cleared.map((t: Trigger) => t.id)).toEqual(["18abc899", "3b6ac96d", "dd1cfbac"]);
    expect(said(r.triggers)).toEqual([
      "Buy if within 2% of the 50-day average",
      "Review every 7 days",
      "Stop watching if below the 50-day average · only on the close and above 1.5× normal volume",
    ]);
    // Code's own triggers: marked as the playbook's, each with its template's reason, written as code's (DEFAULT).
    expect(r.triggers.every((t) => t.playbook === "WATCH" && t.rationale.length > 0 && t.source === "DEFAULT")).toBe(true);
    const updates = r.db.store.thesisUpdate as Array<{ summary?: string; rationale?: string | null }>;
    expect(updates.map((u) => u.summary)).toEqual([
      expect.stringMatching(/^Cleared for the rewrite under its playbook: /),
      "Its playbook's watch triggers, put on for the rewrite: Buy if within 2% of the 50-day average; Review every 7 days; Stop watching if below the 50-day average · only on the close and above 1.5× normal volume",
    ]);
    // Titles only, no paragraph the app wrote, and the review clock where it was.
    expect(updates.every((u) => u.rationale == null)).toBe(true);
    expect(r.lastReviewedAt).toEqual(REVIEWED);
    expect(r.send).toHaveBeenCalledTimes(1);
    expect(r.send.mock.calls[0]).toEqual([expect.objectContaining({ name: "app/thesis.write.requested", data: expect.objectContaining({ ticker: "MA", mode: "refresh", existingThesisId: MA.thesisId }) })]);
  });

  it("a refused stamp puts the cleared triggers back at once and sends nothing", async () => {
    // A playbook trigger the save refuses: its reason is empty.
    const broken = (id: string) => playbookTemplates(null, id).map((t, i) => (i === 0 ? { ...t, rationale: "" } : t));
    const r = await rewrite(broken);
    expect(r.out).toMatchObject({ ok: false, putBack: 3 });
    expect((r.out as { why: string }).why).toMatch(/^the playbook's triggers were refused/);
    expect(r.triggers.map((t) => t.id).sort()).toEqual(["18abc899", "3b6ac96d", "dd1cfbac"]);
    expect(r.send).not.toHaveBeenCalled();
  });

  it("a watch with a stored trigger that can't be read is skipped: its row byte-unchanged, nothing journaled, written or sent", async () => {
    // Writing back what parses would delete the unreadable one without a word and without a journal entry.
    const r = await rewrite(playbooks, [...MA.triggers, { id: "unreadable", action: "REVIEW", source: "AGENT", predicate: { kind: "NOT_A_PREDICATE" }, rationale: "An old shape." }]);
    expect(r.out).toEqual({ ok: false, skipped: true, why: "$MA skipped: 1 stored trigger can't be read", putBack: 0 });
    expect(r.rowUnchanged).toBe(true);
    expect(r.journal).toBeNull();
    expect(r.db.store.thesisUpdate).toEqual([]);
    expect(r.send).not.toHaveBeenCalled();
  });
});
