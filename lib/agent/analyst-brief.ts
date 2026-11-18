/**
 * analyst-brief.ts — the analyst, rendered once (step 10,
 * docs/plans/AGENT_ARCHITECTURE.md §11.6).
 *
 * Every door that works for one analyst puts `analystBrief` in its prompt and
 * renders no part of the analyst itself: the morning run and the Run button,
 * the trigger run, the chat pinned to an analyst, the writer and discovery.
 * The brief is the analyst's name, its strategy word for word, its rules'
 * numbers and the stocks it may cover (its fence, where it narrows them), the room it has when the
 * caller knows it, and one line per setup it has chosen. It is the shared
 * instruction text "the_analyst" (lib/agent/engine/parts.ts). Nothing else:
 * the job, the stock and the house rules are each agent's own.
 *
 * A playbook is written once, by `playbookChecks`. The brief takes its first sentence;
 * the writer takes all of them, with the playbook's watch triggers.
 *
 * Pure and safe in the browser: modes.ts, which client components import,
 * renders the brief for the chat.
 */
import { capacityLine, type AnalystCapacity } from "@/lib/agent/capacity";
import { getSetup, isNamedSetup, type Setup } from "@/lib/agent/knowledge/setups";
import type { SetupOverrides } from "@/lib/agent/knowledge/setup-overrides";
import { positionTotalCap } from "@/lib/agent/position-sizing";
import { GICS_SECTORS } from "@/lib/universe/gics";

/**
 * The analyst as the brief reads it: an AgentConfig row, or the same fields
 * after a step boundary (a money column comes back as a string, a bound as a
 * number or a bigint). Unset fields render as the morning run always rendered
 * them.
 */
export interface BriefAnalyst extends UniverseAnalyst {
  name?: string | null;
  analystPrompt?: string | null;
  directionBias?: string | null;
  holdDurations?: readonly string[] | null;
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
  marketCapMin?: unknown;
  marketCapMax?: unknown;
  exclusionList?: readonly string[] | null;
}

/** The fields the brief reads, for a script that saves an analyst for a replay. */
export const BRIEF_FIELDS = [
  "name", "analystPrompt", "directionBias", "holdDurations", "minPositionSize",
  "maxPositionSize", "maxPositionTotal", "maxOpenPositions", "setupIds",
  "sectors", "marketCapMin", "marketCapMax", "exclusionList",
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
 * One playbook's words, written once, in two cuts. "all" (the writer's
 * block): what it is, what must be true, how a buy is confirmed, and what
 * failure looks like. The brief takes the first of them. "decision" (a row's
 * `playbook_checks`): what a fire checks, from the confirmation on. Its buy and
 * every other trigger are the playbook's templates, which each door prints
 * beside these (playbookTriggerText).
 */
export function playbookChecks(setup: Setup, cut: "all" | "decision" = "all"): string[] {
  const confirm = setup.entry.confirmation.length ? setup.entry.confirmation.join("; ") : "the level holding";
  const chase = setup.entry.chaseLimitPct != null ? `; not more than ${setup.entry.chaseLimitPct}% past the buy trigger's price` : "";
  return [
    ...(cut === "all" ? [`${setup.id} — ${setup.name}: ${setup.summary}`, `Needs: ${setup.preconditions.join("; ")}`] : []),
    `Confirm a buy by: ${confirm}${chase}`,
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
    min > 0
      ? `- Position size: ${dollars(min)}–${dollars(max)} per entry (place_trade sizes every buy inside this band by risk)`
      : `- Max position size: ${dollars(max)}`,
    `- Most in one stock: ${dollars(positionTotalCap({ maxPositionSize: max, maxPositionTotal: amount(analyst.maxPositionTotal) }))}`,
    `- Max open positions: ${analyst.maxOpenPositions ?? 5}`,
    ...fenceLines(analyst).map((l) => `- ${l}`),
  ];
  const roomLine = capacityLine(room);
  if (roomLine) rules.push(`- ${roomLine}`);
  const setups = chosenSetups(analyst);
  return [
    `## Analyst: ${analyst.name || "Research Analyst"}`,
    ...(analyst.analystPrompt ? [analyst.analystPrompt] : []),
    ["Rules:", ...rules].join("\n"),
    ...(setups.length ? [["Playbooks:", ...setups.map((s) => `- ${playbookChecks(s)[0]}`)].join("\n")] : []),
  ].join("\n\n");
}

function capText(v: unknown): string | null {
  const n = amount(v);
  if (n == null) return null;
  return `$${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)}B`;
}

/**
 * The stocks it may cover, where its fence narrows them: its sectors when
 * they are some of the 11, its market-cap band when it has one, its
 * exclusions when it has any. An analyst with no fence prints none (every
 * sector listed is no fence). Measured: the three lines printed for an
 * unfenced analyst ("Sectors: …all 11…", "Market cap: no bound",
 * "Exclusions: (none)") changed three of six morning decisions (2026-11-18).
 */
export function fenceLines(analyst: UniverseAnalyst): string[] {
  const sectors = analyst.sectors ?? [];
  const narrows = sectors.length > 0 && !GICS_SECTORS.every((s) => sectors.includes(s));
  const lo = capText(analyst.marketCapMin);
  const hi = capText(analyst.marketCapMax);
  return [
    ...(narrows ? [`Sectors: ${sectors.join(", ")}`] : []),
    ...(lo != null || hi != null ? [`Market cap: ${lo ?? "no floor"} – ${hi ?? "no ceiling"}`] : []),
    ...(analyst.exclusionList?.length ? [`Exclusions: ${analyst.exclusionList.join(", ")}`] : []),
  ];
}
