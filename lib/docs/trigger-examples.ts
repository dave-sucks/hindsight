/**
 * The examples on the Triggers page, one tab per trigger type (the same five
 * types as the Add trigger menu, TRIGGER_TYPES in
 * lib/agent/triggers/condition/catalog.ts). Each example is a real condition:
 * the page draws it with the app's own pill and sentence (describe.ts), so the
 * words can't drift from the product. trigger-examples.test.ts holds every
 * measure in the catalog to at least one example, and every example to the
 * trigger schema the save path uses.
 *
 * Client-safe.
 */

import type { TriggerType, When } from "@/lib/agent/triggers/condition";
import type { TriggerAction } from "@/lib/agent/triggers/types";

export interface TriggerExample {
  action: TriggerAction;
  when: When;
  /** Why someone sets it, in a sentence. Shown under the pill and in its popover. */
  why: string;
}

export interface TriggerTypeDoc {
  type: TriggerType;
  /** The tab's subtitle. */
  blurb: string;
  /** How the check reads this type. */
  checked: string;
  examples: readonly TriggerExample[];
}

export const TRIGGER_TYPE_DOCS: readonly TriggerTypeDoc[] = [
  {
    type: "price",
    blurb: "A level, a line on the chart, or a move from somewhere that matters.",
    checked:
      "Read against the live price every five minutes while the market is open. A level marked only on the close waits for the 4:20 PM pass and the day's closing price, and a floor on a stock you only watch always does. The move from our entry and the give-back from the high read the position itself: its average cost and the highest price since the buy.",
    examples: [
      { action: "EXIT", when: { watch: "price", is: "below", value: 40.8 }, why: "The floor. Under the breakout shelf, and above the rising 20-day." },
      { action: "ENTER", when: { watch: "move", is: "near", value: 2, variable: "sma20" }, why: "Buy the pullback, not the spike: the setup is true near a rising average." },
      { action: "EXIT", when: { watch: "move", is: "below", value: 12, variable: "peak", settings: { startOnceUpPct: 10 } }, why: "A trail. It arms once the position has been up 10%, then follows the high." },
      { action: "TRIM", when: { watch: "move", is: "above", value: 15.6, variable: "entry", settings: { fastWinnerPct: 20, fastWinnerDays: 21 } }, why: "Take a partial at twice the risk, unless it's a fast winner worth holding whole." },
      { action: "ADD", when: { watch: "move", is: "above", value: 7, variable: "prev_close" }, why: "A big up day on a holding asks whether to press it." },
      { action: "REVIEW", when: { watch: "price", is: "below", variable: "sma200" }, why: "A long-term holding losing its 200-day is worth a look. A state, so it asks at most weekly." },
    ],
  },
  {
    type: "indicator",
    blurb: "The chart's own numbers: volume, RSI, strength against the S&P, gaps.",
    checked:
      "Read from the chart numbers computed at 6:30 AM each trading day: moving averages, highs and lows, RSI, strength against the S&P, recent gaps. They sit next to the live price on every pass. Volume and gaps also read today's volume so far, so a volume trigger is true only once the volume is really there.",
    examples: [
      { action: "REVIEW", when: { watch: "volume", value: 2 }, why: "Twice the normal volume means someone knows something. Look before it moves." },
      { action: "ENTER", when: { watch: "rsi", is: "below", value: 30 }, why: "An oversold dip in a stock whose trend is still up." },
      { action: "REVIEW", when: { watch: "strength", value: 5, settings: { window: "3M" } }, why: "Leading the market by 5 points over three months: a leader worth a closer look." },
      { action: "ENTER", when: { watch: "gap", value: 8, settings: { volume: 3, withinDays: 3 } }, why: "An 8% gap on three times the volume, held for three days: an episodic pivot." },
    ],
  },
  {
    type: "earnings",
    blurb: "Before a report, after a report, and what the report said.",
    checked:
      "Read from the earnings calendar on every pass, one call for the whole book. A heads-up fires before the report date. A beat or a miss fires at the first open after the report, once per report, with the figures in its Activity line.",
    examples: [
      { action: "REVIEW", when: { watch: "report", is: "before", value: 3 }, why: "Three days out: decide whether to hold through the print." },
      { action: "REVIEW", when: { match: "all", conditions: [{ watch: "surprise", is: "beat", value: 0 }, { watch: "move", is: "below", value: 3, variable: "prev_close" }] }, why: "A beat the market sold. Read the call before trusting the number." },
      { action: "REVIEW", when: { watch: "surprise", is: "miss", value: 5 }, why: "A real miss. Check whether the belief still holds." },
      { action: "REVIEW", when: { watch: "report", is: "after", value: 5 }, why: "The days right after the print, when the drift starts and the call gets read." },
    ],
  },
  {
    type: "filing",
    blurb: "What the company tells the SEC, and what its insiders buy.",
    checked:
      "Read live from SEC EDGAR, once per pass for every stock with a filing trigger, looking back four days. Each filing fires once; filings cluster, so there's no rest period. Insider buying counts open-market purchases from Form 4s, refreshed every morning.",
    examples: [
      { action: "REVIEW", when: { watch: "filing", variable: "tier:MATERIAL" }, why: "Anything material: a deal, a departure, a guidance change." },
      { action: "REVIEW", when: { watch: "filing", variable: "tier:RED" }, why: "A red flag: a restatement, an auditor change, a going-concern note." },
      { action: "REVIEW", when: { watch: "filing", variable: "item:8.01" }, why: "Other events, where companies announce FDA dates and trial results." },
      { action: "REVIEW", when: { watch: "insiders", value: 3, settings: { days: 90 } }, why: "Three insiders buying with their own money is a signal worth reading." },
    ],
  },
  {
    type: "schedule",
    blurb: "Clocks, not conditions: look again, or leave on time.",
    checked:
      "A clock counts calendar days. Every N days counts from the last real review, so a stock someone just looked at waits its full interval. After the buy and around the event date count from the dates on the position and the thesis.",
    examples: [
      { action: "REVIEW", when: { watch: "repeat", value: 30 }, why: "The review clock: re-underwrite a quiet holding once a month." },
      { action: "EXIT", when: { watch: "from_date", is: "after", value: 60, variable: "buy" }, why: "The setup's time limit: out before the next report if it hasn't worked." },
      { action: "REVIEW", when: { watch: "from_date", is: "before", value: 10, variable: "event" }, why: "Ten days before the FDA decision: size up, hold, or step aside." },
    ],
  },
];
