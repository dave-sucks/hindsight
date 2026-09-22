/**
 * wait-for-thesis-refresh.handoff.test.ts — the run that commissioned a
 * refresh is handed the plan it wrote (DAV-301).
 *
 * Replay: CYTK, 2026-09-21, thesis cmroeg0l2000c04jux1gjdqhk.
 *   12:04:56  MORNING_PLAN cmub769ly001l04l8agl1clmr dispatches
 *             THESIS_WRITER cmub773j5001q04l8k68kalre and waits
 *   12:08:01  the writer lands: buy $73.50 → $70.25, target $96 → $88.31,
 *             composite 6 → 3
 *   12:08:17  the parent removes the buy, the floor and the target
 *
 * The parent waited properly. What came back was snapshot text, bull and
 * bear bullets and a research age — "$CYTK refresh complete — research
 * fresh (0d). Proceed." Nothing in it named a level, so the run deleted
 * three it had never seen.
 */
const mockRunFindUnique = jest.fn();
const mockThesisFindUnique = jest.fn();
const mockUpdateFindFirst = jest.fn();
jest.mock("@/lib/prisma", () => ({
  prisma: {
    researchRun: { findUnique: mockRunFindUnique },
    thesis: { findUnique: mockThesisFindUnique },
    thesisUpdate: { findFirst: mockUpdateFindFirst },
  },
}));

import { waitForThesisRefresh } from "./wait-for-thesis-refresh";
import type { ToolContext } from "@/lib/agent/tool-context";

const PARENT = "cmub769ly001l04l8agl1clmr";
const CHILD = "cmub773j5001q04l8k68kalre";
const THESIS = "cmroeg0l2000c04jux1gjdqhk";

const ctx = {
  runId: PARENT,
  userId: "u1",
  accountId: "a1",
  analystId: "cmmmh0wxu000004js7yoyzvlf",
  groupId: (p: string) => p,
} as ToolContext;

beforeEach(() => {
  mockRunFindUnique.mockReset().mockResolvedValue({
    id: CHILD,
    mode: "THESIS_WRITER",
    status: "COMPLETE",
    parentRunId: PARENT,
    parameters: { ticker: "CYTK", existingThesisId: THESIS, mode: "refresh" },
  });
  // The row as the writer left it at 12:08:00.
  mockThesisFindUnique.mockReset().mockResolvedValue({
    id: THESIS,
    ticker: "CYTK",
    snapshot: { text: "CYTK trades at $68.78 (−1.63% today)…", citations: [] },
    bullCase: { bullets: [], citations: [] },
    bearCase: { bullets: [], citations: [] },
    entryPrice: 70.25,
    targetPrice: 88.31,
    stopLoss: 64,
    scoring: { composite: 3 },
    researchUpdatedAt: new Date("2026-09-21T12:08:00.884Z"),
    horizon: "CATALYST",
  });
  mockUpdateFindFirst.mockReset().mockResolvedValue({
    summary:
      "Updated CYTK: Entry $73.50 → $70.25, Entry: fires on the close, Stop: wording updated, Target $96 → $88.31, composite 6 → 3, rationale updated, research refreshed",
  });
});

type ToolResult = {
  ok: boolean;
  summary?: string;
  data?: { items?: { text: string }[]; thesisExcerpt?: { wrote?: { planLine: string } } };
};

async function run() {
  const tool = waitForThesisRefresh(ctx) as unknown as {
    execute: (a: { child_run_id: string }) => Promise<ToolResult>;
  };
  return tool.execute({ child_run_id: CHILD });
}

describe("CYTK — the refresh hands back its plan", () => {
  it("the summary names the levels the parent was about to delete", async () => {
    const res = await run();
    expect(res.summary).toContain("Entry $73.50 → $70.25");
    expect(res.summary).toContain("Target $96 → $88.31");
    expect(res.summary).toContain(
      "The plan the refresh left: buy $70.25, target $88.31, floor $64.00, composite 3/10.",
    );
  });

  it("the tool row shows the same line, not a bullet count", async () => {
    const res = await run();
    const texts = (res.data?.items ?? []).map((i) => i.text);
    expect(texts.some((t) => t.includes("buy $70.25, target $88.31, floor $64.00"))).toBe(true);
    expect(texts.some((t) => /bull \/ .* bear bullets refreshed/.test(t))).toBe(false);
  });

  it("it asks the run to argue against the numbers, and refuses nothing", async () => {
    const res = await run();
    const texts = (res.data?.items ?? []).map((i) => i.text).join(" ");
    expect(texts).toContain("read what it wrote before you change it");
    expect(res.ok).toBe(true);
  });

  it("it only reads the audit row this child wrote", async () => {
    await run();
    expect(mockUpdateFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { thesisId: THESIS, runId: CHILD } }),
    );
  });

  it("a refresh that wrote no audit row still returns the plan on the row", async () => {
    mockUpdateFindFirst.mockResolvedValue(null);
    const res = await run();
    expect(res.summary).toContain("The plan the refresh left: buy $70.25");
  });
});
