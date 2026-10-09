/**
 * analyst-brief.ts — the analyst, rendered once (step 10,
 * docs/plans/AGENT_ARCHITECTURE.md §11.6).
 *
 * Every door that works for one analyst puts `analystBrief` in its prompt and
 * renders no part of the analyst itself: the morning run and the Run button,
 * the trigger run, the chat pinned to an analyst, the writer and discovery.
 * The brief is the analyst's name, its strategy word for word, its rules'
 * numbers, the room it has when the caller knows it, and one line per setup
 * it has chosen. Nothing else: the universe fence is `universeLines`, used by
 * the two doors that show it; the job, the stock and the house rules are each
 * door's own.
 *
 * A setup is written once, by `setupLines`. The brief takes its first line;
 * the writer takes all of them.
 *
 * Pure and safe in the browser: modes.ts, which client components import,
 * renders the brief for the chat.
 */
import { capacityLine, type AnalystCapacity } from "@/lib/agent/capacity";
import { getSetup, isNamedSetup, type Horizon, type Setup } from "@/lib/agent/knowledge/setups";
import type { SetupOverrides } from "@/lib/agent/knowledge/setup-overrides";
import { positionTotalCap } from "@/lib/agent/position-sizing";

/**
 * The analyst as the brief reads it: an AgentConfig row, or the same fields
 * after a step boundary (a money column comes back as a string, a bound as a
 * number or a bigint). Unset fields render as the morning run always rendered
 * them.
 */
export interface BriefAnalyst {
  name?: string | null;
  analystPrompt?: string | null;
  directionBias?: string | null;
  holdDurations?: readonly string[] | null;
  minConfidence?: number | null;
  minPositionSize?: unknown;
  maxPositionSize?: unknown;
  maxPositionTotal?: unknown;
  maxOpenPositions?: number | null;
  setupIds?: readonly string[] | null;
  /** The account's playbook numbers over the catalog (loadSetupOverrides). */
  setupOverrides?: SetupOverrides | null;
}

/** The fence fields: what the analyst may cover. */
export interface UniverseAnalyst {
  sectors?: readonly string[] | null;
  industries?: readonly string[] | null;
  themes?: readonly string[] | null;
  marketCapMin?: unknown;
  marketCapMax?: unknown;
  exclusionList?: readonly string[] | null;
}

/** The fields the brief reads, for a script that saves an analyst for a replay. */
export const BRIEF_FIELDS = [
  "name", "analystPrompt", "directionBias", "holdDurations", "minConfidence", "minPositionSize",
  "maxPositionSize", "maxPositionTotal", "maxOpenPositions", "setupIds",
] as const;

function amount(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const dollars = (n: number) => `$${n.toLocaleString("en-US")}`;

function directionLabel(bias: string | null | undefined): string {
  if (!bias || bias === "BOTH") return "Long & Short";
  if (bias === "LONG_ONLY") return "LONG only";
  if (bias === "SHORT_ONLY") return "SHORT only";
  return bias;
}

/** The setups the analyst chose, with the account's numbers. None chosen, none listed. */
function chosenSetups(analyst: BriefAnalyst): Setup[] {
  const overrides = analyst.setupOverrides ?? undefined;
  return (analyst.setupIds ?? [])
    .filter(isNamedSetup)
    .map((id) => getSetup(id, overrides))
    .filter((s): s is Setup => s != null);
}

/**
 * One setup, written once, in three cuts. "all" (the writer's block): what it
 * is, what must be true, the entry and how a buy is confirmed, the stop, the
 * target, how it is managed, its time limit and what failure looks like. The
 * brief takes the first line of it. "decision" (a row's `setup_lines`): the
 * lines a fire checks, from the entry on; the summary is in the brief and the
 * preconditions are the writer's. With a horizon, the one Manage line for it;
 * without, each horizon's, labelled.
 */
export function setupLines(setup: Setup, horizon?: string | null, cut: "all" | "decision" = "all"): string[] {
  const confirm = setup.entry.confirmation.length ? setup.entry.confirmation.join("; ") : "the level holding";
  const chase = setup.entry.chaseLimitPct != null ? `; not more than ${setup.entry.chaseLimitPct}% past the level` : "";
  const trail = setup.trail as Partial<Record<string, string>>;
  const manage = horizon
    ? [trail[horizon] ?? Object.values(trail)[0]].filter((t): t is string => !!t).map((t) => `Manage: ${t}`)
    : (Object.keys(trail) as Horizon[]).map((h) => `Manage (${h}): ${trail[h]}`);
  return [
    ...(cut === "all" ? [`${setup.id} — ${setup.name}: ${setup.summary}`, `Needs: ${setup.preconditions.join("; ")}`] : []),
    `Entry: ${setup.entry.text} Confirm a buy by: ${confirm}${chase}`,
    `Stop: ${setup.stop.text}`,
    `Target: ${setup.target.text}`,
    ...manage,
    `Time: ${setup.time.text}`,
    `Failure looks like: ${setup.failureSigns.join("; ")}`,
  ];
}

/**
 * The analyst, as every door reads it. `room` is how full it is, when the
 * caller has counted (the morning run always; the trigger run on a buy).
 */
export function analystBrief(analyst: BriefAnalyst, room?: AnalystCapacity | null): string {
  const min = amount(analyst.minPositionSize) ?? 0;
  const max = amount(analyst.maxPositionSize) ?? 2500;
  const rules = [
    `- Direction: ${directionLabel(analyst.directionBias)}`,
    `- Hold style: ${analyst.holdDurations?.length ? analyst.holdDurations.join(", ") : "SWING"}`,
    `- Min confidence: ${analyst.minConfidence ?? 70}%`,
    min > 0
      ? `- Position size: ${dollars(min)}–${dollars(max)} per entry (place_trade sizes every buy inside this band by risk)`
      : `- Max position size: ${dollars(max)}`,
    `- Most in one stock: ${dollars(positionTotalCap({ maxPositionSize: max, maxPositionTotal: amount(analyst.maxPositionTotal) }))}`,
    `- Max open positions: ${analyst.maxOpenPositions ?? 5}`,
  ];
  const roomLine = capacityLine(room);
  if (roomLine) rules.push(`- ${roomLine}`);
  const setups = chosenSetups(analyst);
  return [
    `## Analyst: ${analyst.name || "Research Analyst"}`,
    ...(analyst.analystPrompt ? [analyst.analystPrompt] : []),
    ["Rules:", ...rules].join("\n"),
    ...(setups.length ? [["Setups:", ...setups.map((s) => `- ${setupLines(s)[0]}`)].join("\n")] : []),
  ].join("\n\n");
}

function capText(v: unknown): string | null {
  const n = amount(v);
  if (n == null) return null;
  return `$${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)}B`;
}

/** The analyst's fence, as the two doors that show it read it. */
export function universeLines(analyst: UniverseAnalyst): string[] {
  const list = (v: readonly string[] | null | undefined) => (v?.length ? v.join(", ") : "(any)");
  const lo = capText(analyst.marketCapMin);
  const hi = capText(analyst.marketCapMax);
  return [
    `Sectors: ${list(analyst.sectors)}`,
    `Industries: ${list(analyst.industries)}`,
    `Themes: ${list(analyst.themes)}`,
    `Market cap: ${lo == null && hi == null ? "no bound" : `${lo ?? "no floor"} – ${hi ?? "no ceiling"}`}`,
    `Exclusions: ${analyst.exclusionList?.length ? analyst.exclusionList.join(", ") : "(none)"}`,
  ];
}
