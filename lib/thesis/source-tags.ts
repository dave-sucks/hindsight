/**
 * source-tags.ts — the research writer tags every claim with where it came
 * from ("[STRUCTURED: Price structure]", "[WEB:https://…]") so the app can
 * build the citations. Inside a sentence Dave reads they are noise: 19
 * Activity notes in the 30 days to 2026-10-05 carried them, Visa's first
 * note among them. Display only; the stored text keeps its tags.
 */
const SOURCE_TAG = /\s*\[(?:STRUCTURED|WEB):[^\]]*\]/g;

export function withoutSourceTags(text: string): string {
  return text
    .replace(SOURCE_TAG, "")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .trim();
}
