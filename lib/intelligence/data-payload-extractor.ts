/**
 * Heuristic dataPayload extraction for signals coming from text sources
 * (Sonar headlines + summaries, news feeds, etc.). The trigger evaluator
 * needs structured data on Signal.dataPayload to fire EARNINGS_BEAT,
 * EARNINGS_MISS, GUIDANCE_CHANGE, and FILING predicates against real
 * signals — but our text-based producers don't currently stamp it.
 *
 * This module fills that gap with regex-based extraction. It's lossy:
 *   - "beat by 12%" → surprisePct: 12 ✅
 *   - "exceeded estimates handily" → no surprisePct extracted ❌
 *
 * The right long-term fix is dedicated structured producers (Finnhub
 * earnings actuals API, SEC EDGAR filings feed). This is the bridge until
 * those exist, so the trigger system has SOMETHING to evaluate against.
 *
 * Strategy: read headline + summary, look for high-confidence patterns,
 * stamp dataPayload. Optionally upgrade the SignalType (NEWS → EARNINGS
 * or FILING) so the trigger evaluator's type-gated predicates match.
 *
 * Single-call exit: returns the inputs back if nothing extracts. Producers
 * call this just before createSignal and pass through the (possibly
 * upgraded) shape.
 */
import type { SignalType } from "@/lib/intelligence/types";

export interface ExtractInput {
  type: SignalType;
  headline: string;
  summary: string | null;
  sentiment: string;
  /** Existing dataPayload from caller — preserved unless we add fields. */
  dataPayload?: Record<string, unknown>;
}

export interface ExtractedDataPayload {
  // Earnings shape — read by EARNINGS_BEAT / EARNINGS_MISS predicates.
  surprisePct?: number;
  // Guidance shape — read by GUIDANCE_CHANGE predicate.
  guidanceDirection?: "UP" | "DOWN";
  // Filing shape — read by FILING predicate.
  formType?: "10-K" | "10-Q" | "8-K" | "FORM_4";
}

export interface ExtractResult {
  /** Possibly-upgraded SignalType (e.g. NEWS → EARNINGS / FILING). */
  type: SignalType;
  /** Merged dataPayload — caller's fields preserved, extracted fields added. */
  dataPayload: Record<string, unknown> | undefined;
}

// ── Regex library ───────────────────────────────────────────────────────

/**
 * Match patterns like "beat by 12%", "topped estimates by 12%", "exceeded
 * Wall Street estimates by 12%", "12% above estimates".
 * Captures group 1 = percentage as a string.
 */
const BEAT_PATTERNS: RegExp[] = [
  /\bbeat(?:s|en|ing)?\s+(?:estimates|expectations|consensus|wall\s+street)?\s*by\s+([\d.]+)\s*%/i,
  /\btopped?\s+(?:estimates|expectations|consensus)\s+by\s+([\d.]+)\s*%/i,
  /\bexceeded?\s+(?:estimates|expectations|consensus|wall\s+street\s+estimates?)\s+by\s+([\d.]+)\s*%/i,
  /([\d.]+)\s*%\s+(?:above|over)\s+(?:estimates?|consensus|expectations?|wall\s+street)/i,
  /\bsurprise\s+of\s+([\d.]+)\s*%/i,
];

const MISS_PATTERNS: RegExp[] = [
  /\bmiss(?:ed|es|ing)?\s+(?:estimates|expectations|consensus|wall\s+street)?\s*by\s+([\d.]+)\s*%/i,
  /\bfell\s+short\s+(?:of\s+(?:estimates|expectations))?\s*by\s+([\d.]+)\s*%/i,
  /([\d.]+)\s*%\s+(?:below|under)\s+(?:estimates?|consensus|expectations?)/i,
];

const GUIDANCE_UP_PATTERNS: RegExp[] = [
  /\b(?:rais(?:ed|es|ing)|hik(?:ed|es|ing)|boost(?:ed|s|ing)|lift(?:ed|s|ing)|increas(?:ed|es|ing))\s+(?:full[- ]year\s+|fy\s+|annual\s+|quarterly\s+|its\s+|the\s+|forward\s+)*(?:guidance|outlook|forecast|fy\d+\s+guidance)/i,
  /\b(?:raises|hikes|boosts|lifts|increases)\s+(?:full[- ]year\s+|annual\s+|quarterly\s+)*(?:guidance|outlook|forecast)/i,
  /\bguidance\s+rais(?:ed|es)/i,
];

const GUIDANCE_DOWN_PATTERNS: RegExp[] = [
  /\b(?:cut|cuts|cutting|lower(?:ed|s|ing)|reduc(?:ed|es|ing)|trim(?:med|s|ming)|slash(?:ed|es|ing))\s+(?:full[- ]year\s+|fy\s+|annual\s+|quarterly\s+|its\s+|the\s+|forward\s+)*(?:guidance|outlook|forecast|fy\d+\s+guidance)/i,
  /\bguidance\s+(?:cut|lowered|reduced)/i,
  /\bweak\s+guidance/i,
];

const FILING_PATTERNS: Array<{ regex: RegExp; form: ExtractedDataPayload["formType"] }> = [
  // Specific form types — order matters, longest first.
  { regex: /\b10-K\b/i, form: "10-K" },
  { regex: /\b10-Q\b/i, form: "10-Q" },
  { regex: /\b8-K\b/i, form: "8-K" },
  // Form 4 / insider transactions / Section 16
  { regex: /\bForm\s+4\b/i, form: "FORM_4" },
  { regex: /\bSection\s+16\s+filing/i, form: "FORM_4" },
  { regex: /\binsider\s+(?:transaction|sale|purchase|filing)/i, form: "FORM_4" },
];

// ── Extraction core ─────────────────────────────────────────────────────

function tryExtractSurprise(text: string, polarity: "BEAT" | "MISS"): number | null {
  const patterns = polarity === "BEAT" ? BEAT_PATTERNS : MISS_PATTERNS;
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) {
      const pct = parseFloat(m[1]);
      if (!Number.isNaN(pct) && pct >= 0 && pct < 1000) {
        return polarity === "BEAT" ? pct : -pct;
      }
    }
  }
  return null;
}

function tryExtractGuidance(text: string): "UP" | "DOWN" | null {
  for (const re of GUIDANCE_UP_PATTERNS) if (re.test(text)) return "UP";
  for (const re of GUIDANCE_DOWN_PATTERNS) if (re.test(text)) return "DOWN";
  return null;
}

function tryExtractFiling(text: string): ExtractedDataPayload["formType"] | null {
  for (const { regex, form } of FILING_PATTERNS) {
    if (regex.test(text)) return form;
  }
  return null;
}

/**
 * Run the heuristics. Returns possibly-upgraded type + merged dataPayload.
 *
 * Type upgrade rules:
 *   - Any signal with a surprisePct or guidanceDirection extracted →
 *     upgrade type to EARNINGS (the trigger evaluator gates on type ==
 *     "EARNINGS" for those predicates).
 *   - Any signal with a formType extracted → upgrade type to FILING.
 *   - When both fire (e.g. an earnings 8-K), EARNINGS wins because the
 *     surprise is the more actionable signal.
 *   - Caller's existing type is preserved when nothing extracts.
 */
export function extractDataPayload(input: ExtractInput): ExtractResult {
  const text = `${input.headline}\n${input.summary ?? ""}`;
  const extracted: ExtractedDataPayload = {};

  // Earnings — try beat first, then miss. They shouldn't both match in
  // practice, but if they do the more recent extraction wins (we hit
  // beat first → if miss also matches, miss overwrites). This is fine
  // for the typical "beat top line, missed bottom" headline.
  const beatPct = tryExtractSurprise(text, "BEAT");
  const missPct = tryExtractSurprise(text, "MISS");
  if (beatPct != null) extracted.surprisePct = beatPct;
  if (missPct != null) extracted.surprisePct = missPct;

  // Guidance.
  const guidance = tryExtractGuidance(text);
  if (guidance) extracted.guidanceDirection = guidance;

  // Filings.
  const formType = tryExtractFiling(text);
  if (formType) extracted.formType = formType;

  // Decide the (possibly upgraded) type.
  const isEarningsy =
    extracted.surprisePct != null || extracted.guidanceDirection != null;
  const isFiling = extracted.formType != null;
  const upgradedType: SignalType = isEarningsy
    ? "EARNINGS"
    : isFiling
      ? "FILING"
      : input.type;

  const hasAnyExtracted = isEarningsy || isFiling;
  if (!hasAnyExtracted && !input.dataPayload) {
    return { type: input.type, dataPayload: undefined };
  }

  return {
    type: upgradedType,
    dataPayload: {
      ...(input.dataPayload ?? {}),
      ...extracted,
    },
  };
}
