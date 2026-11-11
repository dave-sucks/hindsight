/**
 * The Market Reviewer's limits: its note field by field, the quote of a
 * cited line, its brief and its searches. Pure (no database, no vendor), so
 * its prompt and the sample prompts read the same numbers the tools check
 * (write-market-note.ts, write-market-brief.ts, web-search.ts).
 */

/** The market brief, for the agents: 3 to 5 sentences. */
export const BRIEF_CHARS = 700;
/** The Market Reviewer's web searches in a run; every other run gets five (web-search.ts). */
export const MARKET_REVIEWER_SEARCH_BUDGET = 10;

/**
 * Each field's limit, in characters. Together they keep a two-stock note to
 * about 1,250 characters, its link not counted (MARKET_NOTE_CHARS).
 */
export const NOTE_FIELD_CHARS = { title: 80, impact: 120, evidence: 300, source_title: 60, meaning: 200, check: 150 } as const;
/** How much of a cited condition or assumption the stock's line quotes. */
export const QUOTE_CHARS = 40;
/** The longest a two-stock note can be with every field at its limit, the link not counted. */
export const MARKET_NOTE_CHARS = 1_250;

/** The first words of a claim, cut at a word: "Management guidance cut in two…". */
export function firstWords(claim: string, chars = QUOTE_CHARS): string {
  const t = claim.replace(/\s+/g, " ").trim();
  if (t.length <= chars) return t;
  const cut = t.slice(0, chars + 1);
  return `${(cut.lastIndexOf(" ") > 10 ? cut.slice(0, cut.lastIndexOf(" ")) : t.slice(0, chars)).replace(/[\s,;:—–-]+$/, "")}…`;
}
