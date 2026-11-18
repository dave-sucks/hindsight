/**
 * The Discovery agent: its request from its record (the analyst opens its
 * instructions, then its own text; the date line, its book and the earnings
 * calendar are its context, and the schedule's kickoff its message), its six
 * tools, its send limit, and the earnings calendar read the way
 * get_earnings_calendar hands it to the model.
 */
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import type { ToolSet } from "ai";
import { composeAgentRequest, dateLine } from "@/lib/agent/engine/engine";
import { DISCOVERY, SENDS_A_RUN } from "@/lib/agent/engine/agents/discovery";
import { SCHEDULE } from "@/lib/agent/engine/schedule";
import { earningsCalendar, withSendLimit } from "./run";

const NOW = new Date("2026-11-18T14:00:00Z");
const KICKOFF = SCHEDULE.find((s) => s.agent === "discovery")!.message!;
const BOOK = "## The book\nHolding (1):\n- IOT · PEAD Specialist · Samsara keeps winning fleets.\nWatching (0):\n- none";
const CALENDAR = "## The earnings calendar\n\nReported, last 7 days:\n- $ZS 2026-11-17: EPS $0.90 vs $0.80 est — beat by 12.5%";

describe("its request", () => {
  const built = composeAgentRequest(DISCOVERY, { now: NOW, environment: "PAPER", message: KICKOFF }, {
    shared: { the_analyst: "## Analyst: PEAD Specialist\n\nI buy the drift." },
    context: { the_book: BOOK, earnings_calendar: CALENDAR },
  });

  it("opens its instructions with the analyst, then its own text", () => {
    expect(built.instructions.startsWith("## Analyst: PEAD Specialist")).toBe(true);
    expect(built.parts.filter((p) => p.where === "instructions").map((p) => p.id)).toEqual(["the_analyst", "own"]);
  });

  it("starts with the date line, its book and the earnings calendar, then the schedule's kickoff", () => {
    expect(KICKOFF).toBe("Find this analyst's next stocks.");
    expect(built.message).toBe([dateLine(NOW, "PAPER"), BOOK, CALENDAR, KICKOFF].join("\n\n"));
  });

  it("has its six tools and no trade tool", () => {
    expect([...built.tools].sort()).toEqual(["dispatch_thesis_research", "get_earnings_calendar", "get_market_movers", "get_stock_data", "run_screen", "web_search"]);
  });

  it("is told its send limit", () => {
    expect(built.instructions).toContain(`Send at most ${SENDS_A_RUN} a run`);
  });
});

describe("its send limit", () => {
  it("sends SENDS_A_RUN stocks to the Writer, then refuses with the ones it sent", async () => {
    const sent: string[] = [];
    const tools = withSendLimit({ dispatch_thesis_research: { execute: async (input: { ticker: string }) => (sent.push(input.ticker), { ok: true }) } } as unknown as ToolSet);
    const dispatch = (ticker: string) => (tools.dispatch_thesis_research as unknown as { execute: (i: unknown, o: unknown) => Promise<{ ok: boolean; error?: string }> }).execute({ ticker }, {});
    for (const t of ["zs", "crwd", "adbe"]) expect((await dispatch(t)).ok).toBe(true);
    const fourth = await dispatch("nke");
    expect(fourth.ok).toBe(false);
    expect(fourth.error).toBe(`You have sent your ${SENDS_A_RUN} stocks for this run (ZS, CRWD, ADBE). Name the rest in your write-up.`);
    expect(sent).toEqual(["zs", "crwd", "adbe"]);
  });

  it("doesn't count a send the tool refused", async () => {
    let n = 0;
    const tools = withSendLimit({ dispatch_thesis_research: { execute: async () => (n++ === 0 ? { ok: false, error: "in flight" } : { ok: true }) } } as unknown as ToolSet);
    const dispatch = (ticker: string) => (tools.dispatch_thesis_research as unknown as { execute: (i: unknown, o: unknown) => Promise<{ ok: boolean }> }).execute({ ticker }, {});
    const results = [];
    for (const t of ["a", "b", "c", "d", "e"]) results.push((await dispatch(t)).ok);
    expect(results).toEqual([false, true, true, true, false]);
  });
});

describe("the earnings calendar it starts with", () => {
  it("is get_earnings_calendar's own lines outside the book: reported in the last 7 days, reporting in the next 14", async () => {
    const asked: unknown[] = [];
    const tools = {
      get_earnings_calendar: {
        execute: async (input: { window: string }) => (
          asked.push(input),
          input.window === "reported"
            ? { ok: true, data: { lines: [{ kind: "generic", text: "1 report 2026-11-11 → 2026-11-18 (discovery set)." }, { kind: "ticker", ticker: "ZS", tag: "2026-11-17", text: "EPS $0.90 vs $0.80 est — beat by 12.5%" }] } }
            : { ok: false, error: "down" }
        ),
      },
    } as unknown as ToolSet;
    expect(await earningsCalendar(tools)).toBe(
      "## The earnings calendar\n\nReported, last 7 days:\n1 report 2026-11-11 → 2026-11-18 (discovery set).\n- $ZS 2026-11-17: EPS $0.90 vs $0.80 est — beat by 12.5%\n\nReporting, next 14 days:\nThe calendar couldn't be read.",
    );
    expect(asked).toEqual([
      { window: "reported", days: 7, scope: "universe" },
      { window: "upcoming", days: 14, scope: "universe" },
    ]);
  });
});
