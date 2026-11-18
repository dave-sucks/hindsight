/**
 * voice.ts — the measures of how every agent writes what the account owner
 * reads. The rules themselves are one markdown file,
 * lib/agent/engine/agents/how-you-write.md, in every agent's instructions
 * that decides on stocks, so no tool field carries its own version.
 *
 * What the owner reads: the paragraph at the top of a stock and every
 * Activity line (update_thesis's rationale), the reason on a buy, add, trim
 * or sale proposal (the trade block and the approval email), a trigger's
 * note, the run-summary lines on the run page, and the narration around
 * tool calls.
 *
 * Rewritten 2026-10-20: notes led with the trigger and our shorthand, and
 * said nothing about the company. Two styles now: a note answers what is
 * going on and what to do; the stock's standing description reads like a
 * company page. Wording only: no rule here refuses a save.
 * 2026-10-28: notes still opened with the line and the fire ("still below the
 * sale line… the signal still holds"). Every note now has one shape: what is
 * going on with the company and why, what it means for why we own it, then
 * one closing sentence of what we did. What to find out is the stock's
 * situation text (situations.ts); this is how to write what was found.
 * 2026-11-04: the shape held but the notes ran 130 to 220 words, three
 * sentences of 50 to 70 words each, in desk words ("valuation compression",
 * "backlog conversion", "the protection line was passed"). A note is now two
 * to four sentences, about 60 to 90 words, said the way a markets podcaster
 * would say it; the first sentence says what happened and what we're doing.
 * `noteCheck` below measures a note against that; it is a measure for the
 * tests and scripts/voice-count.ts, and nothing refuses a save on it.
 */

/** A note's length, in words. */
export const NOTE_WORDS = { min: 60, max: 90 } as const;

/** A note's length, in sentences. */
export const NOTE_SENTENCES = { min: 2, max: 4 } as const;

/** The most numbers a note keeps, dates and share counts aside (the rules: the two or three that matter). */
export const NOTE_NUMBERS = 3;

/** The desk's words, in the forms the notes used them; each is a plain phrase in the rules above. */
export const DESK_WORDS: ReadonlyArray<[string, RegExp]> = [
  ["catalyst", /\bcatalysts?\b/i],
  ["thesis intact", /\b(thesis|case) (is |remains |stays )?intact\b/i],
  ["constructive", /\bconstructive\b/i],
  ["re-rate", /\bre-?rat(e|es|ed|ing)\b/i],
  ["multiple", /\bmultiples?\b/i],
  ["risk/reward", /\brisk[\/-]reward\b|\breward[\/-]to[\/-]risk\b|\breward against risk\b/i],
  ["exposure", /\bexposures?\b/i],
  ["positioning", /\bpositioning\b/i],
  ["invalidation", /\binvalidat(e|es|ed|ion|ing)\b/i],
  ["the print", /\bthe print\b|\bpost-print\b/i],
  ["the tape", /\bthe tape\b/i],
  ["de-risking", /\bde-?risk(s|ed|ing)?\b/i],
  ["read-through", /\bread-?through\b/i],
  ["proof point", /\bproof points?\b/i],
];

const MONTH = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?$/i;

/** The words of a text. */
export const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** The sentences of a text: a break is ". ", "! " or "? " followed by a capital, a quote or a dollar sign (so "Oct. 28" and "U.S. data" don't split). */
export const sentencesOf = (text: string): string[] =>
  text
    .trim()
    .split(/(?<=[.!?]["”’)]?)\s+(?=["“$(]?[A-Z])/)
    .filter((s) => s.trim().length > 0);

/** The numbers a note keeps, counted as the rules count them: a date's day and a share count are left out. */
export function numbersOf(text: string): string[] {
  const words = wordsOf(text);
  const kept: string[] = [];
  words.forEach((w, i) => {
    const m = w.match(/^[("]?([$€£]?\d+(?:,\d{3})*(?:\.\d+)?%?)[),.;:"]*$/);
    if (!m) return;
    const prev = words[i - 1] ?? "";
    const next = (words[i + 1] ?? "").replace(/[,.;:]+$/, "");
    if (MONTH.test(prev)) return;
    if (/^(sh|shares?)$/i.test(next)) return;
    kept.push(m[1]);
  });
  return kept;
}

/**
 * What a note does that the rules say not to: too long or too short, too many
 * sentences, a first sentence that runs on, too many numbers, a desk word.
 * Empty when it fits. A measure, not a gate: the tests and voice-count.ts read
 * it, and nothing refuses a save on it.
 */
export function noteCheck(text: string): string[] {
  const off: string[] = [];
  const words = wordsOf(text).length;
  const sentences = sentencesOf(text);
  if (words > NOTE_WORDS.max) off.push(`${words} words, over ${NOTE_WORDS.max}`);
  if (words < NOTE_WORDS.min) off.push(`${words} words, under ${NOTE_WORDS.min}`);
  if (sentences.length > NOTE_SENTENCES.max) off.push(`${sentences.length} sentences, over ${NOTE_SENTENCES.max}`);
  if (sentences.length < NOTE_SENTENCES.min) off.push(`${sentences.length} sentence, under ${NOTE_SENTENCES.min}`);
  const first = sentences[0] ? wordsOf(sentences[0]).length : 0;
  if (first > 30) off.push(`the first sentence runs ${first} words`);
  const numbers = numbersOf(text);
  if (numbers.length > NOTE_NUMBERS) off.push(`${numbers.length} numbers (${numbers.join(", ")}), over ${NOTE_NUMBERS}`);
  for (const [name, re] of DESK_WORDS) if (re.test(text)) off.push(`desk word: ${name}`);
  return off;
}
