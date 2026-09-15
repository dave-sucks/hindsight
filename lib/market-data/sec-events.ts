/**
 * The SEC event list — which filings matter and how much. Pure: no fetch,
 * no environment, safe in the trigger UI. The EDGAR reader is
 * ./sec-filings.
 *
 * The tier table lives here, in code, so no prompt has to memorize item
 * codes. docs/plans/SEC_FILINGS.md §3.
 */

import type { TriggerPredicate } from "@/lib/agent/triggers/types";

// ── The event list ──────────────────────────────────────────────────────────

/**
 * RED — something may be broken; look today.
 * MATERIAL — the story may have changed; look at the next review.
 * CONTEXT — routine; never wakes anyone.
 */
export type FilingTier = "RED" | "MATERIAL" | "CONTEXT";

/** 8-K item codes, by what they mean in plain words. */
export const ITEM_NAMES: Record<string, string> = {
  "1.01": "major agreement signed",
  "1.02": "major agreement ended",
  "1.03": "bankruptcy or receivership",
  "2.01": "acquisition or sale completed",
  "2.02": "earnings results",
  "2.03": "new debt",
  "2.05": "restructuring or layoffs",
  "2.06": "asset write-down",
  "3.01": "delisting notice",
  "3.02": "shares sold privately",
  "4.01": "auditor change",
  "4.02": "past financials can't be relied on",
  "5.02": "officer or director leaving or joining",
  "5.07": "shareholder vote",
  "7.01": "press release",
  "8.01": "other events",
  "9.01": "exhibits",
};

const RED_ITEMS = new Set(["4.02", "1.03", "3.01", "4.01"]);
const MATERIAL_ITEMS = new Set(["5.02", "1.01", "1.02", "2.01", "2.05", "2.06", "3.02"]);

/** Forms that are an event by themselves (no item codes). */
export const FORM_NAMES: Record<string, string> = {
  "NT 10-K": "late annual report",
  "NT 10-Q": "late quarterly report",
  "SCHEDULE 13D": "activist stake (5%+)",
  "424B5": "shares or bonds offered",
  "S-3": "registration to sell shares or bonds",
};
const RED_FORMS = new Set(["NT 10-K", "NT 10-Q"]);
const MATERIAL_FORMS = new Set(["SCHEDULE 13D", "424B5", "S-3"]);

/** The forms the evaluator asks EDGAR for. 8-K covers 8-K/A. */
export const WATCHED_FORMS = ["8-K", ...RED_FORMS, ...MATERIAL_FORMS];

export interface SecFiling {
  /** The accession number — the filing's own ID. One fire per filing keys on it. */
  accession: string;
  /** The company on the book this filing is about (10-digit, zero-padded). */
  cik: string;
  ticker: string;
  /** As filed — "8-K", "8-K/A", "NT 10-Q", "SCHEDULE 13D/A". */
  form: string;
  /** The form without an amendment suffix — "8-K", "SCHEDULE 13D". */
  rootForm: string;
  /** 8-K item codes; empty for other forms. */
  items: string[];
  /** YYYY-MM-DD, as EDGAR dates it. */
  filedDate: string;
  tier: FilingTier;
  /** The primary document on sec.gov. */
  url: string;
}

const TIER_RANK: Record<FilingTier, number> = { CONTEXT: 0, MATERIAL: 1, RED: 2 };

/**
 * The tier of one filing. An amended 8-K carries its items like the
 * original (a restatement is often filed as 8-K/A). An amended 13D, 424B5
 * or S-3 is paperwork on an event already counted — context.
 */
export function classifyFiling(f: { rootForm: string; form: string; items: string[] }): FilingTier {
  const amended = f.form.endsWith("/A");
  if (f.rootForm === "8-K") {
    if (f.items.some((i) => RED_ITEMS.has(i))) return "RED";
    if (f.items.some((i) => MATERIAL_ITEMS.has(i))) return "MATERIAL";
    return "CONTEXT";
  }
  if (RED_FORMS.has(f.rootForm)) return "RED";
  if (MATERIAL_FORMS.has(f.rootForm) && !amended) return "MATERIAL";
  return "CONTEXT";
}

/** "8-K — officer or director leaving or joining (5.02)". */
export function describeFilingEvent(f: Pick<SecFiling, "form" | "rootForm" | "items">): string {
  if (f.rootForm === "8-K") {
    const named = f.items.filter((i) => i !== "9.01");
    const words = named.map((i) => `${ITEM_NAMES[i] ?? "item"} (${i})`);
    return words.length ? `${f.form} — ${words.join(", ")}` : f.form;
  }
  const name = FORM_NAMES[f.rootForm];
  return name ? `${f.form} — ${name}` : f.form;
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The activity-row sentence: "Filed 8-K — officer or director leaving or joining (5.02), Aug 26. <link>" */
export function describeFiling(f: SecFiling): string {
  return `Filed ${describeFilingEvent(f)}, ${fmtDay(f.filedDate)}. ${f.url}`;
}

// ── Matching a trigger ──────────────────────────────────────────────────────

type SecEventPredicate = Extract<TriggerPredicate, { kind: "SEC_EVENT" }>;

/**
 * Does this filing satisfy the predicate? `tier` is "at least" — MATERIAL
 * matches red too. `items` / `forms` name a specific event. Any one given
 * condition matching is a match.
 */
export function filingMatches(p: SecEventPredicate, f: SecFiling): boolean {
  if (p.tier && TIER_RANK[f.tier] >= TIER_RANK[p.tier]) return true;
  if (p.items?.length && f.rootForm === "8-K" && f.items.some((i) => p.items!.includes(i))) return true;
  if (p.forms?.length && p.forms.some((form) => form === f.rootForm || form === f.form)) return true;
  return false;
}

/** The filings that would fire this predicate now: matching, and not already fired on. */
export function unfiredMatches(
  p: SecEventPredicate,
  filings: SecFiling[] | null | undefined,
  fired: readonly string[] | null | undefined,
): SecFiling[] {
  if (!filings?.length) return [];
  const seen = new Set(fired ?? []);
  return filings.filter((f) => !seen.has(f.accession) && filingMatches(p, f));
}

/** How many fired filing IDs a trigger remembers. The lookback is days; this is plenty. */
export const FIRED_FILINGS_KEPT = 50;

/** Remember these filings as fired, newest last, capped. */
export function rememberFired(prior: readonly string[] | null | undefined, accessions: string[]): string[] {
  const merged = [...(prior ?? []).filter((a) => !accessions.includes(a)), ...accessions];
  return merged.slice(-FIRED_FILINGS_KEPT);
}

/** Every SEC_EVENT inside a predicate, composites included. */
export function secEventLeaves(p: TriggerPredicate): SecEventPredicate[] {
  if (p.kind === "SEC_EVENT") return [p];
  if (p.kind === "AND" || p.kind === "OR") return p.predicates.flatMap(secEventLeaves);
  return [];
}

/**
 * The filings behind a fire: every unfired filing any SEC_EVENT in the
 * trigger matches. What the activity row names, what gets remembered so it
 * never fires this trigger again, and what decides the urgency.
 */
export function filingsBehindFire(
  trigger: { predicate: TriggerPredicate; firedFilings?: readonly string[] },
  filings: SecFiling[] | null | undefined,
): SecFiling[] {
  const out = new Map<string, SecFiling>();
  for (const leaf of secEventLeaves(trigger.predicate)) {
    for (const f of unfiredMatches(leaf, filings, trigger.firedFilings)) out.set(f.accession, f);
  }
  return Array.from(out.values());
}

/**
 * A red filing on a stock we own can't wait for tomorrow's review: it wakes
 * a tactical run the same day (principal ruling 2026-09-15). Red on a watch
 * and every material filing go to the next morning's review.
 */
export function filingNeedsSameDayLook(filings: SecFiling[], thesisStatus: string): boolean {
  return thesisStatus === "HOLDING" && filings.some((f) => f.tier === "RED");
}
