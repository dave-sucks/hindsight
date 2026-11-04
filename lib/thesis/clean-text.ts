/**
 * The citation tags the Writer leaves in its prose ("[STRUCTURED: …]",
 * "[WEB: …]"), removed before a person reads it on the page or an agent
 * reads it on its row. Pure and import-free, so the client bundle can use it.
 */
export function stripCitationTags(s: string): string {
  return s.replace(/\s*\[(STRUCTURED|WEB)[^\]]*\]/g, "").replace(/[ \t]{2,}/g, " ").trim();
}
