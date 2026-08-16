/**
 * Add / edit / delete standing triggers at the ACCOUNT and ANALYST levels
 * of the cascade — the write side of lib/agent/triggers/levels.
 *
 * The thesis-level equivalents live in ./thesis-edit and do considerably
 * more work (canonical stop/target mirroring onto Thesis + Position, a
 * ThesisUpdate audit row, held-only gating). None of that applies here:
 * a standing rule isn't attached to a position, has no price to mirror,
 * and belongs to no thesis's activity log.
 *
 * ## Constant rungs only
 *
 * A level above the thesis can only express rules that mean the same
 * thing on every name it covers. "Trail 6%" does. "Exit below $64.00"
 * does not — there is no account-wide $64.00, and a thesis-parameterized
 * rung stored up here would fire nonsense on every other ticker. That is
 * the whole of `LEVEL_ELIGIBLE_PREDICATE_KINDS`, and it's enforced here
 * rather than in the UI so a hand-rolled request can't bypass it.
 */

import { prisma } from "@/lib/prisma";
import { triggersArraySchema } from "@/lib/agent/triggers/schema";
import { editableTriggerField, withEditedValue } from "@/lib/agent/triggers/editable";
import { predicateSentence } from "@/lib/agent/triggers/format";
import { isDirectEligiblePredicate } from "@/lib/agent/triggers/types";
import { triggerBucket } from "@/lib/agent/triggers/bucket";
import type {
  Trigger,
  TriggerAction,
  TriggerPredicate,
} from "@/lib/agent/triggers/types";
import { ThesisEditError, buildPrincipalTrigger } from "@/lib/actions/thesis-edit";

/** The two levels this module writes. THESIS goes through ./thesis-edit. */
export type WritableLevel = "ACCOUNT" | "ANALYST";

/**
 * Predicate kinds whose meaning is independent of any one thesis, and so
 * can be expressed as a standing rule.
 *
 * Excluded on purpose:
 *   • PRICE_ABOVE / PRICE_BELOW — an absolute dollar level is meaningless
 *     across tickers.
 *   • REVIEW_DATE_HIT — reads `Thesis.nextReviewAt`, a per-thesis date.
 *   • AND / OR — composites of the above; allow once there's a UI that
 *     can build them, not before.
 *   • EARNINGS_* / GUIDANCE_CHANGE / FILING / SIGNAL_TYPE — these need
 *     the signal-routing path, which is severed (GAPS P1-34: 0 routes in
 *     14d). Accepting them here would mint standing rules that are born
 *     unable to fire, on the surface whose whole purpose is making rules
 *     visible and trustworthy. Re-add when routing is rebuilt.
 *
 * GAIN_FROM_ENTRY and TRAILING_FROM_HIGH ARE allowed even though they're
 * position-scoped: they evaluate false with no open position rather than
 * erroring, and "every holding trails 6%" is the single most valuable
 * thing an account-level rule can say.
 */
export const LEVEL_ELIGIBLE_PREDICATE_KINDS: ReadonlySet<TriggerPredicate["kind"]> =
  new Set([
    "PRICE_MOVE_PCT",
    "GAIN_FROM_ENTRY",
    "TRAILING_FROM_HIGH",
    "TIME_ELAPSED",
    "VS_SMA",
    "RSI",
  ]);

export interface LevelTriggerContext {
  accountId: string;
  actorUserId: string;
}

/** Where a standing rule is stored, and how to describe it in an error. */
interface LevelTarget {
  read: () => Promise<Trigger[]>;
  write: (next: Trigger[]) => Promise<void>;
  label: string;
}

async function resolveTarget(
  level: WritableLevel,
  ownerId: string,
  ctx: LevelTriggerContext,
): Promise<LevelTarget> {
  if (level === "ACCOUNT") {
    // ownerId is the accountId; it must match the caller's own account —
    // the session's accountId is the authority, never the request body.
    if (ownerId !== ctx.accountId) {
      throw new ThesisEditError("FORBIDDEN", "That is not your account.");
    }
    return {
      label: "account",
      read: async () => {
        const row = await prisma.account.findUnique({
          where: { id: ctx.accountId },
          select: { triggers: true },
        });
        if (!row) throw new ThesisEditError("NOT_FOUND", "Account not found.");
        return parseOrRefuse(row.triggers, "account");
      },
      write: async (next) => {
        await prisma.account.update({
          where: { id: ctx.accountId },
          data: { triggers: next as unknown as object },
        });
      },
    };
  }

  const analyst = await prisma.agentConfig.findUnique({
    where: { id: ownerId },
    select: { id: true, name: true, accountId: true, triggers: true },
  });
  if (!analyst) throw new ThesisEditError("NOT_FOUND", `Analyst ${ownerId} not found.`);
  if (analyst.accountId !== ctx.accountId) {
    throw new ThesisEditError("FORBIDDEN", "That analyst is not on this account.");
  }
  return {
    label: analyst.name,
    read: async () => parseOrRefuse(analyst.triggers, `analyst ${analyst.name}`),
    write: async (next) => {
      await prisma.agentConfig.update({
        where: { id: analyst.id },
        data: { triggers: next as unknown as object },
      });
    },
  };
}

/**
 * Parse a level's stored array, REFUSING on malformed JSON. The read
 * paths fail open (a bad rung must not take down a live stop); a write
 * path must fail closed, because falling back to [] here would persist
 * only the new rung and silently delete every existing one.
 */
function parseOrRefuse(raw: unknown, label: string): Trigger[] {
  const parsed = triggersArraySchema.safeParse(raw ?? []);
  if (!parsed.success) {
    throw new ThesisEditError(
      "INVALID",
      `The ${label} standing triggers couldn't be parsed — refusing to write (it would overwrite them).`,
    );
  }
  return parsed.data as Trigger[];
}

function assertLevelEligible(predicate: TriggerPredicate): void {
  if (LEVEL_ELIGIBLE_PREDICATE_KINDS.has(predicate.kind)) return;
  throw new ThesisEditError(
    "INVALID",
    `"${predicateSentence(predicate)}" is specific to one thesis — a standing rule has to mean the same thing on every name it covers. Set an absolute price level on the thesis itself.`,
  );
}

export interface LevelTriggerAddInput {
  action: TriggerAction;
  predicate: TriggerPredicate;
  fireMode?: "TACTICAL" | "DIRECT";
  rationale?: string;
  cooldownDays?: number;
}

export async function addLevelTrigger(
  level: WritableLevel,
  ownerId: string,
  input: LevelTriggerAddInput,
  ctx: LevelTriggerContext,
): Promise<Trigger> {
  assertLevelEligible(input.predicate);
  const target = await resolveTarget(level, ownerId, ctx);
  const existing = await target.read();

  // One rung per bucket at a given level — a second "trail X%" here would
  // be dead weight (resolveLadder keeps the first and silently drops the
  // rest), so refuse it with an explanation instead.
  const candidateBucket = triggerBucket({
    predicate: input.predicate,
    action: input.action,
  });
  if (existing.some((t) => triggerBucket(t) === candidateBucket)) {
    throw new ThesisEditError(
      "INVALID",
      `A "${predicateSentence(input.predicate)}" rule already exists at this level — edit that one instead of adding a second.`,
    );
  }

  // DIRECT (act with no agent) stays restricted to deterministic EXITs,
  // exactly as on the thesis. There's no position to check here, so the
  // predicate gate is the whole gate.
  const created = buildPrincipalTrigger({
    ...input,
    defaultRationale: `${predicateSentence(input.predicate)} — standing rule set by the principal.`,
    allowDirect:
      input.action === "EXIT" && isDirectEligiblePredicate(input.predicate.kind),
  });

  const next = [...existing, created];
  if (!triggersArraySchema.safeParse(next).success) {
    throw new ThesisEditError("INVALID", "That would exceed the 20-trigger cap.");
  }
  await target.write(next);
  return created;
}

export async function editLevelTriggerValue(
  level: WritableLevel,
  ownerId: string,
  triggerId: string,
  value: number,
  ctx: LevelTriggerContext,
): Promise<Trigger> {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ThesisEditError("INVALID", "value must be a positive number.");
  }
  const target = await resolveTarget(level, ownerId, ctx);
  const existing = await target.read();
  const found = existing.find((t) => t.id === triggerId);
  if (!found) {
    throw new ThesisEditError(
      "NOT_FOUND",
      `Trigger ${triggerId} is not stored at this level. App defaults are code constants and can't be edited — override one by adding a rule here.`,
    );
  }
  if (!editableTriggerField(found.predicate)) {
    throw new ThesisEditError("INVALID", "That trigger has no editable value.");
  }

  const updated: Trigger = {
    ...found,
    predicate: withEditedValue(found.predicate, value),
  };
  await target.write(existing.map((t) => (t.id === triggerId ? updated : t)));
  return updated;
}

export async function setLevelTriggerFireMode(
  level: WritableLevel,
  ownerId: string,
  triggerId: string,
  fireMode: "TACTICAL" | "DIRECT",
  ctx: LevelTriggerContext,
): Promise<Trigger> {
  const target = await resolveTarget(level, ownerId, ctx);
  const existing = await target.read();
  const found = existing.find((t) => t.id === triggerId);
  if (!found) {
    throw new ThesisEditError("NOT_FOUND", `Trigger ${triggerId} not found at this level.`);
  }
  if (
    fireMode === "DIRECT" &&
    (found.action !== "EXIT" || !isDirectEligiblePredicate(found.predicate.kind))
  ) {
    throw new ThesisEditError(
      "INVALID",
      "Only a deterministic EXIT can act without waking an analyst run.",
    );
  }
  const updated: Trigger = { ...found, fireMode };
  await target.write(existing.map((t) => (t.id === triggerId ? updated : t)));
  return updated;
}

export async function deleteLevelTrigger(
  level: WritableLevel,
  ownerId: string,
  triggerId: string,
  ctx: LevelTriggerContext,
): Promise<void> {
  const target = await resolveTarget(level, ownerId, ctx);
  const existing = await target.read();
  if (!existing.some((t) => t.id === triggerId)) {
    throw new ThesisEditError(
      "NOT_FOUND",
      `Trigger ${triggerId} is not stored at this level. App defaults can't be deleted — they're the floor beneath every level.`,
    );
  }
  await target.write(existing.filter((t) => t.id !== triggerId));
}
