/**
 * Should the per-trade email be suppressed because the trade happened
 * inside the morning batch (and will be folded into the 10 AM digest)?
 *
 * Rule: suppress IFF
 *   - the trade was placed inside a ResearchRun with mode = MORNING_PLAN,
 *     AND
 *   - it's right now Mon-Fri 7-10 AM ET (the morning cron window).
 *
 * Manual "Run" clicks at 2 PM use MORNING_PLAN mode too but fall outside
 * the window → they fire an immediate email. Tactical runs always have a
 * different mode → they fire immediately. Closes from price-monitor /
 * user-UI / EOD-flatten don't carry a runId at all → caller passes
 * `runMode = null` and gets immediate.
 *
 * The 10 AM digest cron fires at the upper boundary; trades emitted at
 * 9:58 AM are suppressed and appear in the digest, trades at 10:01 AM
 * fire immediate (they missed the cutoff).
 */
export function isInsideMorningBatch(
  runMode: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (runMode !== "MORNING_PLAN") return false;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hourStr = parts.find((p) => p.type === "hour")?.value ?? "00";
  // Intl with hour12:false sometimes returns "24" at midnight; normalise.
  const hour = parseInt(hourStr, 10) % 24;
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday ?? "");
  const isWindow = hour >= 7 && hour < 10;
  return isWeekday && isWindow;
}
