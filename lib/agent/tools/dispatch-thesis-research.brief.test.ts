/**
 * Send to the Writer: the stock, the brief, and the link the idea came from,
 * if there is one. Code finds the thesis by the stock; the Writer picks the
 * playbook. A long brief is trimmed, never a reason to refuse the send.
 *
 * Replay: the principal chat's first LUXE dispatch, 2026-09-17 22:50 ET —
 * its reason and its 458-character screen row, now one brief.
 */

jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/inngest/client", () => ({ inngest: { send: jest.fn() } }));
import type { z } from "zod";
import { dispatchThesisResearch, BRIEF_MAX } from "./dispatch-thesis-research";

const LUXE_BRIEF =
  "Survives PEAD triage — dispatching for the deep look. Reported 2026-09-16, EPS +111% vs est, all three segments returned to growth (Q4 GMV +7.9%), gapped ~17% on 18× volume. Gap held — stock added another +3.3% day-after on 3.6× volume. Price $9.48, 27-day base (depth 12%) broken out.";

const schemaOf = (runMode = "PRINCIPAL_CHAT", analystId?: string) =>
  (dispatchThesisResearch({ runId: "r", userId: "u", runMode, analystId } as never) as unknown as { inputSchema: z.ZodObject<z.ZodRawShape> }).inputSchema;

describe("send to the Writer", () => {
  it("takes the stock, the brief and an optional link; the unscoped chat also names the analyst", () => {
    expect(Object.keys(schemaOf().shape).sort()).toEqual(["analyst_id", "brief", "source_link", "ticker"]);
    expect(Object.keys(schemaOf("PRINCIPAL_CHAT", "an").shape).sort()).toEqual(["brief", "source_link", "ticker"]);
    expect(Object.keys(schemaOf("MORNING_PLAN", "an").shape).sort()).toEqual(["brief", "source_link", "ticker"]);
    // A trigger run sends its own stock.
    expect(Object.keys(schemaOf("INTRADAY_TACTICAL", "an").shape).sort()).toEqual(["brief", "source_link"]);
  });

  it("the LUXE send is accepted as one brief", () => {
    const parsed = schemaOf().safeParse({ ticker: "LUXE", analyst_id: "cmnhxpjio000004jvox6kl6c7", brief: LUXE_BRIEF, source_link: "https://example.com/post" });
    expect(parsed.success).toBe(true);
    expect((parsed.data as { brief: string }).brief).toBe(LUXE_BRIEF);
  });

  it("a long brief is trimmed at a whole word, never refused", () => {
    const parsed = schemaOf().safeParse({ ticker: "LUXE", analyst_id: "a", brief: "word ".repeat(2_000) });
    expect(parsed.success).toBe(true);
    const brief = (parsed.data as { brief: string }).brief;
    expect(brief.length).toBeLessThanOrEqual(BRIEF_MAX);
    expect(brief.endsWith("word…")).toBe(true);
  });
});
