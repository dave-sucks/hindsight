/**
 * Server-side glue between the database and the pure cascade resolver
 * (./levels). Loads the ACCOUNT + ANALYST levels once per batch and turns
 * a thesis row into its resolved ladder.
 *
 * Everything that decides what a thesis's ladder IS goes through here —
 * the trigger evaluator, the thesis dossier route, the agent's
 * `get_theses`. One loader means the ladder the UI draws and the ladder
 * the 5-minute cron fires are the same ladder, which is the entire point
 * of the cascade (see the header of ./levels).
 */

import { prisma } from "@/lib/prisma";
import { parseTriggersResilient } from "./schema";
import { resolveLadder, type ResolvedTrigger } from "./levels";
import type { Horizon, ThesisState } from "./defaults";
import type { Trigger } from "./types";
import { unseededAccountFallback } from "./seed-account";

/** The two stored levels above a thesis, for one analyst. */
export interface LevelSources {
  analyst: Trigger[];
  account: Trigger[];
}

const EMPTY_SOURCES: LevelSources = { analyst: [], account: [] };

/**
 * Parse a `Trigger[]` JSONB column. A malformed array yields `[]` with a
 * warning rather than throwing — the same fail-open posture the evaluator
 * uses for `Thesis.triggers`, for the same reason: one bad rung must not
 * take down the whole ladder (and with it a live stop).
 */
export function parseLevelTriggers(raw: unknown, label: string): Trigger[] {
  if (raw == null) return [];
  // Rung-by-rung, not all-or-nothing: one bad field used to discard the
  // entire ladder (GD/ASML/ETN lost 8/8/6 rungs each to a single
  // out-of-range cooldown). See parseTriggersResilient.
  const { triggers, clamped, dropped } = parseTriggersResilient(raw);
  if (clamped > 0 || dropped > 0) {
    console.warn(
      `[trigger-levels] ${label}: repaired ${clamped} rung(s) with an out-of-range cooldown, dropped ${dropped} unparseable rung(s); ${triggers.length} kept`,
    );
  }
  return triggers as Trigger[];
}

/**
 * Load the analyst + account trigger arrays for a set of analysts, keyed
 * by analyst id. One query for the batch — the evaluator resolves up to
 * 200 theses per tick and must not issue a query per thesis.
 *
 * Analysts not found (or a thesis whose research run has no analyst) map
 * to empty levels, so resolution degrades to thesis + code defaults.
 */
export async function loadLevelSources(
  analystIds: string[],
): Promise<Map<string, LevelSources>> {
  const out = new Map<string, LevelSources>();
  const ids = Array.from(new Set(analystIds.filter(Boolean)));
  if (ids.length === 0) return out;

  const configs = await prisma.agentConfig.findMany({
    where: { id: { in: ids } },
    select: { id: true, accountId: true, triggers: true },
  });

  // AgentConfig.accountId carries no Prisma relation to Account, so the
  // account level is a second lookup rather than an include. Distinct
  // account ids only — in practice one, and never more than a handful.
  const accountIds = Array.from(new Set(configs.map((c) => c.accountId).filter(Boolean)));
  const accounts = accountIds.length
    ? await prisma.account.findMany({
        where: { id: { in: accountIds } },
        select: { id: true, triggers: true, triggersSeededAt: true },
      })
    : [];
  // A seeded account's array is authoritative — including when it is
  // empty, which means the principal deleted every rule. Only a NEVER
  // seeded account falls back to the code constants.
  const accountTriggers = new Map(
    accounts.map((a) => [
      a.id,
      a.triggersSeededAt == null
        ? unseededAccountFallback(a.id)
        : parseLevelTriggers(a.triggers, `account=${a.id}`),
    ]),
  );

  for (const c of configs) {
    out.set(c.id, {
      analyst: parseLevelTriggers(c.triggers, `analyst=${c.id}`),
      account: accountTriggers.get(c.accountId) ?? [],
    });
  }
  return out;
}

/**
 * The thesis-state axis the default templates key off. `HELD` is the only
 * state that carries position-scoped rungs (gain-from-entry, trail,
 * scale-ins) — see `inheritableDefaultLadder`.
 */
export function thesisStateFor(status: string | null): ThesisState {
  if (status === "HOLDING") return "HELD";
  if (status === "PROMOTED") return "PROMOTED";
  return "WATCHING";
}

/** Null/unknown horizon behaves as TARGET — the middle-of-the-road template. */
export function horizonFor(horizon: string | null): Horizon {
  return horizon === "CATALYST" ||
    horizon === "TRADE" ||
    horizon === "COMPOUNDER" ||
    horizon === "TARGET"
    ? horizon
    : "TARGET";
}

/** The thesis columns resolution needs. Keep selects in sync with this. */
export interface ThesisLadderRow {
  triggers: unknown;
  triggerState?: unknown;
  status: string | null;
  horizon: string | null;
  /**
   * Optional. Decides which of two same-bucket protective triggers is the
   * tighter one (`protectiveTightestFirst` in ./levels). Callers that
   * already select `direction` should pass it; absent behaves as LONG.
   */
  direction?: string | null;
}

/**
 * Resolve one thesis row into the ladder actually in force on it.
 *
 * `sources` comes from `loadLevelSources` keyed by the thesis's analyst;
 * pass `undefined` for a thesis with no analyst owner and it resolves
 * against the code defaults alone.
 */
export function resolveThesisLadder(
  thesis: ThesisLadderRow,
  sources: LevelSources | undefined,
  label = "thesis",
): ResolvedTrigger[] {
  const { analyst, account } = sources ?? EMPTY_SOURCES;
  return resolveLadder({
    thesis: parseLevelTriggers(thesis.triggers, label),
    analyst,
    account,
    // No DEFAULT level any more — the constant rungs are seeded onto the
    // account as editable rules (lib/agent/triggers/seed-account), so the
    // cascade bottoms out at ACCOUNT. `state` still gates the
    // position-scoped kinds, which are meaningless without a position at
    // ANY level.
    defaults: [],
    state: thesisStateFor(thesis.status),
    direction: thesis.direction ?? null,
    // resolveLadder only wants the cooldown stamp; `side` is the
    // evaluator's business.
    triggerState: Object.fromEntries(
      Object.entries(parseTriggerState(thesis.triggerState)).map(
        ([id, e]) => [id, e.firedAt] as const,
      ),
    ),
  });
}

/**
 * Per-thesis, per-trigger bookkeeping held in `Thesis.triggerState`.
 *
 *   firedAt — cooldown stamp for an INHERITED rung. It can't live on the
 *             rung because that rung is shared by every thesis under its
 *             level (thesis-level rungs keep `lastFiredAt` inline).
 *
 * A `side` field (the last evaluated side of an edge-triggered predicate)
 * was declared here for the 2026-08-13 latch and never written. Entry
 * crossing (DAV-229) needs no stored side — it reads the prior close off
 * the quote — so the field is gone.
 */
export interface TriggerStateEntry {
  firedAt?: string;
}

/**
 * Parse `Thesis.triggerState`. Hand-validated rather than Zod'd: it is a
 * server-written map with no user input path, and a malformed entry
 * should cost that one rung its history, not the whole ladder.
 *
 * Accepts the original bare-string shape (`{ [id]: ISO }`) and lifts it
 * to `{ firedAt }` — rows stamped before the object shape parse correctly
 * rather than silently losing their cooldown.
 */
export function parseTriggerState(
  raw: unknown,
): Record<string, TriggerStateEntry> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, TriggerStateEntry> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") {
      out[k] = { firedAt: v };
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const e = v as { firedAt?: unknown };
      if (typeof e.firedAt === "string") out[k] = { firedAt: e.firedAt };
    }
  }
  return out;
}
