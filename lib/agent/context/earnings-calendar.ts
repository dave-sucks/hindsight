/**
 * earnings_calendar: who reported in the last 7 days and who reports in the
 * next 14, outside the analyst's book, as get_earnings_calendar hands it to
 * the model, read through the run's own tool.
 */
import type { ToolSet } from "ai";
import type { Fact } from "./fact";

type Line = { kind: "generic"; text: string } | { kind: "ticker"; ticker: string; tag?: string; text: string };
type Exec = (input: Record<string, unknown>, options: unknown) => Promise<unknown>;

/** The earnings calendar outside the analyst's book, under its heading. */
export async function earningsCalendar(tools: ToolSet): Promise<string> {
  const execute = (tools.get_earnings_calendar as unknown as { execute: Exec }).execute;
  const read = async (window: "reported" | "upcoming", days: number) => {
    const out = (await execute({ window, days, scope: "universe" }, { toolCallId: `context-${window}`, messages: [] })) as { ok: boolean; data?: { lines?: Line[] } };
    if (!out.ok || !out.data?.lines) return `The calendar couldn't be read.`;
    return out.data.lines.map((l) => (l.kind === "ticker" ? `- $${l.ticker} ${l.tag ?? ""}: ${l.text}` : l.text)).join("\n");
  };
  return [`## The earnings calendar`, `Reported, last 7 days:\n${await read("reported", 7)}`, `Reporting, next 14 days:\n${await read("upcoming", 14)}`].join("\n\n");
}

export const earningsCalendarFact: Fact = {
  analyst: async (run) => {
    if (!run.toolset?.get_earnings_calendar) throw new Error("the earnings calendar is read through the run's get_earnings_calendar, and this run has none");
    return earningsCalendar(run.toolset);
  },
};
