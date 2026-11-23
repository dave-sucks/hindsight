/**
 * The schedule: every agent that runs on a clock, written down once
 * (docs/plans/AGENT_ENGINE.md, pass 2). The one scheduler
 * (lib/inngest/functions/agent-scheduler.ts) runs each agent that is on at
 * its time, once per traded book or once per enabled analyst, through the
 * agent runner (runAgentAsRun, ./run.ts), which opens the run and keeps its
 * books. A new scheduled agent is a line here: no job and no save code of
 * its own. A scheduled agent's "when it runs" is read from its line
 * (whenItRuns), never kept a second time on its record.
 *
 * Client-safe: the Agents page reads it.
 */
import type { AgentId, AgentRecord } from "./types";

export interface ScheduledAgent {
  agent: AgentId;
  /** When, in New York time, as a cron: minute, hour, day of the month, month, day of the week (0 Sunday). */
  cron: string;
  /** One run per traded book, or one per enabled analyst. */
  per: "book" | "analyst";
  /** A day the market is closed runs nothing. */
  marketDaysOnly: boolean;
  on: boolean;
  /** The kickoff the schedule writes it, its message, when it writes one (after the date line every run opens with). */
  message?: string;
}

export const SCHEDULE: readonly ScheduledAgent[] = [
  { agent: "portfolio_manager", cron: "30 10 * * 2,4", per: "book", marketDaysOnly: true, on: true },
  // Off until the owner rewrites its job text and turns it on.
  { agent: "discovery", cron: "0 9 * * 2,4", per: "analyst", marketDaysOnly: true, on: false, message: "Find this analyst's next stocks." },
];

/** A cron in New York time, as Inngest takes it. */
export const inNewYork = (cron: string) => `TZ=America/New_York ${cron}`;

/** The scheduler's triggers: each time an agent that is on runs, once. */
export function scheduleTriggers(schedule: readonly ScheduledAgent[] = SCHEDULE): Array<{ cron: string }> {
  return [...new Set(schedule.filter((s) => s.on).map((s) => inNewYork(s.cron)))].map((cron) => ({ cron }));
}

/** The agents due when a trigger fires: those that are on, at that time. */
export function dueAt(fired: string, schedule: readonly ScheduledAgent[] = SCHEDULE): ScheduledAgent[] {
  const bare = (c: string) => c.replace(/^TZ=\S+\s+/, "").trim();
  return schedule.filter((s) => s.on && bare(s.cron) === bare(fired));
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const inWords = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const range = (d: string) => {
  const [a, b] = d.split("-").map(Number);
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
};

/** A schedule's cron in words: "Tuesday and Thursday at 10:00 AM ET". Written for the shapes the schedule uses: one time, and every day, weekdays, or a list or range of days. */
export function cronInWords(cron: string): string {
  const [minute, hour, , , dow] = cron.trim().split(/\s+/);
  const h = Number(hour);
  const time = `${h % 12 || 12}:${minute.padStart(2, "0")} ${h < 12 ? "AM" : "PM"} ET`;
  const days =
    dow === "*"
      ? "Every day"
      : dow === "1-5"
        ? "Weekdays"
        : inWords(dow.split(",").flatMap((d) => (d.includes("-") ? range(d) : [Number(d)])).map((d) => DAYS[d % 7]));
  return `${days} at ${time}`;
}

/** When an agent runs: a scheduled agent's line in words, else its record's own (an agent an event starts). */
export function whenItRuns(record: Pick<AgentRecord, "id" | "runsWhen">, schedule: readonly ScheduledAgent[] = SCHEDULE): string {
  const line = schedule.find((s) => s.agent === record.id);
  if (!line) return record.runsWhen ?? "";
  return `${cronInWords(line.cron)}, one run per ${line.per === "book" ? "traded book" : "analyst"}.${line.on ? "" : " Off until you turn it on."}`;
}
