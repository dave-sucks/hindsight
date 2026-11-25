/**
 * parse-sections.ts — the source markers in what the Writer saves
 * ([STRUCTURED:<field>], [WEB:<url>]): read out as citations, and taken out of
 * the text they sat in.
 *
 * Until 2026-11-24 the Writer wrote a research note in prose and this file cut
 * it into the company line and the bull and bear cases by their headers; a
 * header the model didn't write exactly dropped its section with nothing
 * said. Those are fields of the save now (`submit_thesis`), refused by name
 * when missing.
 */

export function parseCitations(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[(STRUCTURED|WEB):([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = `${match[1]}:${match[2]}`;
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out;
}

/**
 * A paragraph without its source markers. They are already in the section's
 * `citations`; left in the text they print inside the sentence (18 of 30
 * snapshots in the 30 days to 2026-10-05 read like "…alongside Mastercard.
 * [STRUCTURED:MarketCap] The stock closed at…"). The company line is saved
 * this way.
 */
export function withoutCitationMarkers(text: string): string {
  return text
    .replace(/\s*\[(?:STRUCTURED|WEB):[^\]]*\]/g, "")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .trim();
}
