/**
 * The citation tags the Writer leaves in its prose ("[STRUCTURED: …]",
 * "[WEB: …]"), removed before a person reads it on the page or an agent
 * reads it on its row. Pure and import-free, so the client bundle can use it.
 */
export function stripCitationTags(s: string): string {
  return s.replace(/\s*\[(STRUCTURED|WEB)[^\]]*\]/g, "").replace(/[ \t]{2,}/g, " ").trim();
}

/**
 * A text's first paragraph, without citation tags: the opinion's summary,
 * where a place shows one line of it (the portfolio snapshot every run gets,
 * the outlook's hover). Null when there is no text.
 */
export function firstParagraph(s: string | null | undefined): string | null {
  const first = (s ?? "").trim().split(/\n\s*\n/)[0] ?? "";
  const clean = stripCitationTags(first.replace(/\*\*/g, ""));
  return clean || null;
}
