/**
 * Variables: what the {x} button inside the value input offers. A variable
 * stands in for a typed number ("below the 200-day average" instead of
 * "below $288.29"), or is what a % or a day count is measured from.
 *
 * Each variable carries what belongs to it: its words, whether it needs a
 * position, whether a sale measured from it can go straight to a proposal,
 * and its own settings (the trailing options live on the high since we
 * bought). The resolver that reads a variable's number lives with the
 * checker (PR 2); this module is the words.
 *
 * Pure and client-safe.
 */

import { FORM_NAMES, ITEM_NAMES } from "@/lib/market-data/sec-events";
import type { DateVariable, FilingVariable, PriceVariable, SettingDef, VariableId } from "./types";
import { capitalise, pct } from "./words";

export interface VariableDef {
  id: VariableId;
  /** The variable menu's row. */
  label: string;
  /** The variable menu's section. */
  group: string;
  /** The chip in the input and on the pill. */
  chip: string;
  /** In a sentence: "below {words}". */
  words: string;
  /** Exists only once we own the stock. */
  position?: boolean;
  /** A sale measured from it has nothing to judge, so it can be proposed with no analyst. */
  direct?: boolean;
  /** Variables that are one rule at different values share a slot ("any material filing" and "a red flag"). */
  slot?: string;
  /** Settings that belong to this variable. None has a select: an agent writes them, the form carries them. */
  settings?: readonly SettingDef[];
}

export const PRICE_VARIABLES: readonly (VariableDef & { id: PriceVariable })[] = [
  { id: "prev_close", label: "Yesterday's close", group: "Recent closes", chip: "yesterday's close", words: "yesterday's close", direct: true },
  { id: "close_5d", label: "Close 5 days ago", group: "Recent closes", chip: "5 days ago", words: "the close 5 days ago", direct: true },
  { id: "close_20d", label: "Close 20 days ago", group: "Recent closes", chip: "20 days ago", words: "the close 20 days ago", direct: true },
  {
    id: "entry",
    label: "Our entry",
    group: "Our position",
    chip: "our entry",
    words: "our entry",
    position: true,
    direct: true,
    settings: [
      // The big-winner switch: don't take the profit on a stock that ran up fast.
      {
        key: "fastWinnerPct",
        words: (v, s) => ` (not if it ran up ${pct(Number(v))}${typeof s.fastWinnerDays === "number" ? ` within ${s.fastWinnerDays} days` : ""})`,
      },
      { key: "fastWinnerDays" },
    ],
  },
  {
    id: "peak",
    label: "High since we bought",
    group: "Our position",
    chip: "high since we bought",
    words: "the high since we bought",
    position: true,
    direct: true,
    settings: [
      { key: "startOnceUpPct", words: (v) => `, once it has been up ${pct(Number(v))}` },
      { key: "widenAtr", words: (v) => ` (or ${v}× its daily range, if wider)` },
    ],
  },
  { id: "sma20", label: "20-day average", group: "Averages", chip: "20-day average", words: "the 20-day average" },
  { id: "sma50", label: "50-day average", group: "Averages", chip: "50-day average", words: "the 50-day average" },
  { id: "sma150", label: "150-day average", group: "Averages", chip: "150-day average", words: "the 150-day average" },
  { id: "sma200", label: "200-day average", group: "Averages", chip: "200-day average", words: "the 200-day average" },
  { id: "high20", label: "20-day high", group: "Highs and lows", chip: "20-day high", words: "the 20-day high" },
  { id: "low20", label: "20-day low", group: "Highs and lows", chip: "20-day low", words: "the 20-day low" },
  { id: "high52", label: "52-week high", group: "Highs and lows", chip: "52-week high", words: "the 52-week high" },
  { id: "low52", label: "52-week low", group: "Highs and lows", chip: "52-week low", words: "the 52-week low" },
];

export const DATE_VARIABLES: readonly (VariableDef & { id: DateVariable })[] = [
  { id: "buy", label: "The buy", group: "Dates", chip: "the buy", words: "the buy" },
  { id: "event", label: "The event date", group: "Dates", chip: "the event date", words: "the event date" },
];

/** Any filing of a tier, then every 8-K item and watched form the evaluator knows (lib/market-data/sec-events). */
export const FILING_VARIABLES: readonly (VariableDef & { id: FilingVariable })[] = [
  { id: "tier:MATERIAL", label: "Anything material", group: "Any filing", chip: "anything material", words: "something material with the SEC", slot: "tier" },
  { id: "tier:RED", label: "A red flag", group: "Any filing", chip: "a red flag", words: "a red-flag filing with the SEC", slot: "tier" },
  ...Object.entries(ITEM_NAMES)
    // Exhibits and the earnings release are not events a review waits on.
    .filter(([code]) => code !== "9.01" && code !== "2.02")
    .map(([code, name]) => ({
      id: `item:${code}` as FilingVariable,
      label: `${capitalise(name)} (8-K ${code})`,
      group: "8-K events",
      chip: `8-K ${code}`,
      words: `an 8-K ${code} (${name})`,
    })),
  ...Object.entries(FORM_NAMES).map(([form, name]) => ({
    id: `form:${form}` as FilingVariable,
    label: `${capitalise(name)} (${form})`,
    group: "Forms",
    chip: form,
    words: `a ${form} (${name})`,
  })),
];

const ALL: ReadonlyMap<string, VariableDef> = new Map(
  [...PRICE_VARIABLES, ...DATE_VARIABLES, ...FILING_VARIABLES].map((v) => [v.id, v]),
);

/** The definition for an id, or a plain fallback for one no list knows (an old form name). */
export function variableDef(id: VariableId): VariableDef {
  const known = ALL.get(id);
  if (known) return known;
  const code = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  return { id, label: code, group: "Other", chip: code, words: code };
}
