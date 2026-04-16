/**
 * Universe helpers — shared by agent tools that need to check whether a
 * ticker / sector / industry / cap is in-scope for the analyst's fence.
 *
 * Match semantics (see docs/UNIVERSE_HANDOFF.md):
 *   - empty array / null numeric = no filter on that dimension
 *   - AND across non-empty dimensions, OR within a dimension
 *   - exclusionList wins (hard reject)
 *   - watchlist + open positions bypass the fence (handled upstream)
 *
 * These helpers only cover the structured checks. The agent still owns the
 * narrative "outside Universe" judgment at the prompt layer — these guardrails
 * are belt-and-suspenders for the exclusionList case plus informational checks
 * on get_stock_data results.
 */

export interface UniverseFence {
  sectors?: string[];
  industries?: string[];
  themes?: string[];
  marketCapMin?: number | null;
  marketCapMax?: number | null;
  exclusionList?: string[];
}

export interface TickerFacts {
  ticker: string;
  sector?: string | null;
  industry?: string | null;
  marketCap?: number | null; // dollars
}

export interface UniverseCheck {
  /** true = every non-empty dimension is satisfied and the ticker is NOT excluded */
  inUniverse: boolean;
  /** true only for hard-reject exclusionList hits */
  excluded: boolean;
  /** one-line reasons the ticker failed (empty if inUniverse) */
  failedReasons: string[];
  /** dimension values that matched (for UI / narration) */
  matched: {
    sector?: string;
    industry?: string;
    marketCapOk?: boolean;
  };
}

/** Normalize a tag for loose matching: lowercase, strip non-alphanumeric. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Case-insensitive normalized contains check for a value in an array. */
function includesNorm(haystack: string[], needle: string): boolean {
  const n = norm(needle);
  if (!n) return false;
  return haystack.some((h) => norm(h) === n);
}

/**
 * Is the ticker on the analyst's exclusionList? Hard reject — wins over
 * every other dimension. Used to block place_trade and manage_watchlist ADD.
 */
export function isExcluded(ticker: string, fence: UniverseFence): boolean {
  const list = fence.exclusionList;
  if (!list?.length) return false;
  const upper = ticker.toUpperCase().trim();
  return list.some((e) => e.toUpperCase().trim() === upper);
}

/**
 * Full Universe check given the analyst's fence and the ticker's facts.
 * Returns a structured result the tool can include in its data payload for
 * UI rendering + narration hints.
 *
 * When a dimension on the analyst side is empty (e.g. no industries set),
 * that dimension is considered satisfied (no filter). If a dimension is set
 * but the ticker's facts don't include the corresponding field, the check
 * is inconclusive — we treat that as "satisfied" (don't block on missing
 * data) and record it so the caller can narrate "data missing" if useful.
 */
export function checkUniverse(facts: TickerFacts, fence: UniverseFence): UniverseCheck {
  const failedReasons: string[] = [];
  const matched: UniverseCheck["matched"] = {};

  // 1. Exclusion — hard reject
  if (isExcluded(facts.ticker, fence)) {
    return {
      inUniverse: false,
      excluded: true,
      failedReasons: [`$${facts.ticker.toUpperCase()} is on the exclusion list`],
      matched: {},
    };
  }

  // 2. Sectors (AND dimension)
  if (fence.sectors?.length) {
    if (facts.sector && includesNorm(fence.sectors, facts.sector)) {
      matched.sector = facts.sector;
    } else if (facts.sector) {
      failedReasons.push(`sector ${facts.sector} not in [${fence.sectors.join(", ")}]`);
    }
    // If facts.sector is null, don't fail — data missing, treat as inconclusive.
  }

  // 3. Industries (AND dimension)
  if (fence.industries?.length) {
    if (facts.industry && includesNorm(fence.industries, facts.industry)) {
      matched.industry = facts.industry;
    } else if (facts.industry) {
      failedReasons.push(`industry ${facts.industry} not in [${fence.industries.join(", ")}]`);
    }
  }

  // 4. Market cap (AND dimension — value must fall inside [min, max])
  if (fence.marketCapMin != null || fence.marketCapMax != null) {
    const cap = facts.marketCap;
    if (cap != null) {
      let capOk = true;
      if (fence.marketCapMin != null && cap < fence.marketCapMin) {
        capOk = false;
        failedReasons.push(`market cap ${formatCap(cap)} below minimum ${formatCap(fence.marketCapMin)}`);
      }
      if (fence.marketCapMax != null && cap > fence.marketCapMax) {
        capOk = false;
        failedReasons.push(`market cap ${formatCap(cap)} above maximum ${formatCap(fence.marketCapMax)}`);
      }
      matched.marketCapOk = capOk;
    }
  }

  return {
    inUniverse: failedReasons.length === 0,
    excluded: false,
    failedReasons,
    matched,
  };
}

/** Short human label for a dollar amount. 500_000_000 → "$500M". */
export function formatCap(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return "—";
  if (amount >= 1_000_000_000_000) return `$${(amount / 1_000_000_000_000).toFixed(1)}T`;
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(0)}M`;
  return `$${amount.toFixed(0)}`;
}
