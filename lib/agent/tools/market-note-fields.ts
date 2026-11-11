/**
 * The Market Reviewer's note, field by field: each field's limit and the
 * quote of a cited line. Pure, so the prompt and the tests read the same
 * numbers the tool checks (write-market-note.ts).
 */

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
