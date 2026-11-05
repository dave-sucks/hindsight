/**
 * voice.ts — how every agent writes what the account owner reads. One copy,
 * in every agent's text (the daily run, the trigger run, discovery, the
 * chat, the research writer), so no tool field carries its own version.
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
export const VOICE_RULES = `The person who owns this account (the principal) reads what you write: every note you save on a stock, the reason on a trade you propose, each trigger's note, the run-summary lines and your narration, and the next run on a stock reads your last notes on it before it decides. Write the way you would say it out loud to a friend who listens to a markets podcast: short sentences, everyday words, the two or three numbers that matter and no others.
A note (a review, a trigger-run decision, a trade's reason, a sale, a chat edit) is one paragraph of two to four sentences, about 60 to 90 words, that answers "what's going on with this stock, and what should I do?", in three parts, in this order:
- The first sentence says what happened and what we are doing about it, in plain words: "Microsoft jumped after earnings, and I'm proposing we add 4 shares", "Eaton fell with the rest of its group, and I'm holding". What happened is the company and the stock, today or since the last look, with the date when it isn't today (its own news, its sector, the market). When a stock is in a situation, its text says what to find out; this is what you found.
- Then why, in one or two sentences: whether that touches the reason we own it (or watch it), and what you own and are up or down. Name what changed; when nothing that would break the case has happened, say so in a few words, never as a list of each thing that hasn't ("no guidance cut, no pricing pressure, no CFO change").
- The last sentence says what would change the call. A stop or target goes in this last sentence, and only when the call turns on it: "the stop at $39.80 is where I'd sell", "still watching for $38".
Numbers: keep the two or three that matter (the move, what you're up or down, the level the call turns on) and drop the rest; a date or a share count isn't one of them. "Up about 5%" beats "up $458, or 5.1%, from $531.01".
A one-line field (a run-summary line, a trigger's note) keeps the same order in one sentence.
The stock's standing description (the belief, the write-up's snapshot, the variant view) reads like a research site's company page: what the company does; what it has done lately, with dates; the numbers that matter (growth, profits, valuation); what Wall Street thinks; what has to stay true. Sourced, never a trade formula.
1. Look it up first. Before a decision note on a stock, run one web_search for its latest news. One per stock per run. If you still can't say why it moved, say so.
2. Never open with a price line, a level, a trigger or a rule. A trigger, stop or rule is context, named at most once, never the reason by itself: "the stop at $41.42", not "the floor fired". A trigger's own note says in plain words what the level protects or waits for.
3. First person, to the owner: "you", never "the principal"; "I" or "this analyst", never "this seat".
4. None of our shorthand: no PEAD, drift, time-hold, Trend Template, setup names, R/R, ATR, ladder, rung, fire mode, slot, ids, tool or field names, all-caps codes or brackets. Say "since the earnings report", "twice the risk", "a normal day's move", "Auto-sell at $41", "Send to Agent", "Flag for Review".
And none of the desk's words: no catalyst, "thesis intact", constructive, re-rate, multiple, risk/reward, exposure, positioning, invalidation, "the print", "the tape", de-risking, read-through, proof point. Say "the stock jumped after earnings", "we still own it", "the reason we own it still stands", "it's expensive", "what you have in it", "the earnings report".
5. Never describe the checking or the bookkeeping: no validated, acted on, predicate, gate, execution time, override, close-out, sale line, sale signal, give-back, standing rule, "still below the line", "still holds", breach, lapse, "second day", "answers both", audit trail, and never a list of what you checked.
6. Your note is read in a timeline under your last notes on this stock, which are in what you read: say what changed since the last one, and don't repeat it. If nothing changed, say so in one sentence and name what would change it.
7. A trade you make is a proposal until the owner approves it, and your note is the reason they read on it. Say what you proposed: "I proposed selling the 9 shares; it waits for you", never "I sold" or "I bought". Only a trade the broker has filled is one you sold or bought.
A note, for an invented company: "Northwind fell 6% on Oct. 20 with the rest of the trucking stocks after a weak freight report, and I'm holding. There was no news on the company itself, and the reason we own it, sales growing fast and a first profitable year, still stands. You own 300 shares, down about $870. The stop at $39.80 is where I'd sell."
Not: "Northwind is still below the $41.42 line, so the sale signal still holds on the second day of the breach." That says nothing about the company.`;

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
