/**
 * playbook-templates.ts — the triggers each playbook starts with, from the
 * tables in docs/plans/PLAYBOOK_TRIGGERS.md. This is the seed: an account's
 * Settings → Playbook list starts as this and is the account's once saved
 * (`Account.playbooks`, ./playbooks).
 *
 * A template is a stored trigger plus when it is written: on a watch (the
 * Writer), with the buy proposal (the trigger run), or at the fill. A
 * `{placeholder}` is a chart level the run fills when it writes the line
 * (PLACEHOLDERS in ./setups). A fill template is written as listed, so it has
 * none. Session counts are stored as calendar days (5 sessions = 7 days).
 */

import type { FireMode } from "@/lib/agent/triggers/fire-mode";
import type { TriggerAction } from "@/lib/agent/triggers/types";
import type { SetupId, TemplatePredicate } from "./setups";

export const WRITTEN_ON = ["WATCH", "PROPOSAL", "FILL"] as const;
export type WrittenOn = (typeof WRITTEN_ON)[number];
/** Each list's name, in the words the agents and the docs read. */
export const TRIGGER_LIST_NAME: Record<WrittenOn, string> = { WATCH: "The playbook's watch triggers", PROPOSAL: "The triggers that come with the buy", FILL: "The triggers written at the fill" };

export interface Template {
  action: TriggerAction;
  predicate: TemplatePredicate;
  rationale: string;
  writtenOn: WrittenOn;
  fireMode?: FireMode;
  trimPct?: number;
}

const breakout: TemplatePredicate = { match: "all", conditions: [{ watch: "price", is: "above", value: "{pivot}", settings: { close: true } }, { watch: "volume", value: 1.5 }, { watch: "price", is: "below", value: "{pivotChase}" }] };
const near50: TemplatePredicate = { watch: "move", is: "near", value: 2, variable: "sma50" };
const under50OnVolume: TemplatePredicate = { match: "all", conditions: [{ watch: "price", is: "below", variable: "sma50" }, { watch: "volume", value: 1.5 }] };
const onClose = (is: "above" | "below", value: `{${string}}`): TemplatePredicate => ({ watch: "price", is, value, settings: { close: true } });
const every = (days: number): TemplatePredicate => ({ watch: "repeat", value: days });
const afterBuy = (days: number): TemplatePredicate => ({ watch: "from_date", is: "after", value: days, variable: "buy" });
const sell: TemplatePredicate = { watch: "price", is: "below", value: "{sellPrice}" };
const trimAtHigh = (why: string): Template => ({ action: "TRIM", trimPct: 50, predicate: { watch: "price", is: "above", value: "{priorHigh}" }, rationale: why, writtenOn: "PROPOSAL" });
const clock = (days: number, why: string): Template[] => [
  { action: "REVIEW", predicate: every(days), rationale: why, writtenOn: "WATCH" },
  { action: "REVIEW", predicate: every(days), rationale: "The watch's clock, kept on the holding.", writtenOn: "FILL" },
];

export const PLAYBOOK_TEMPLATES: Record<SetupId, Template[]> = {
  PRE_CATALYST: [
    { action: "ENTER", predicate: breakout, rationale: "The base's pivot plus 0.1–0.3%, and at most 5% past it. Only when the stock passes the breakout's checks.", writtenOn: "WATCH" },
    { action: "ENTER", predicate: near50, rationale: "Only while the 50-day is rising and the stock's pullbacks held it.", writtenOn: "WATCH" },
    { action: "ENTER", predicate: onClose("above", "{high20}"), rationale: "The 20-day high, above today's price (the reclaim).", writtenOn: "WATCH" },
    ...clock(7, "Moves the reclaim to the latest 20-day high."),
    { action: "STOP_WATCHING", predicate: onClose("below", "{swingLow}"), rationale: "The last swing low.", writtenOn: "WATCH" },
    { action: "STOP_WATCHING", predicate: { watch: "from_date", is: "before", value: 21, variable: "event" }, rationale: "The window closed with no buy.", writtenOn: "WATCH" },
    { action: "EXIT", predicate: sell, rationale: "The last swing low that day, at least 1 ATR under the buy.", writtenOn: "PROPOSAL" },
    { action: "EXIT", predicate: { watch: "from_date", is: "before", value: 7, variable: "event" }, rationale: "The run-up sells before the decision. To hold through the event, the run answering the 10-day review removes this line and says why.", writtenOn: "FILL" },
    trimAtHigh("The prior high. Only if the analyst believes it."),
  ],
  BASE_BREAKOUT: [
    { action: "ENTER", predicate: breakout, rationale: "The base's pivot plus 0.1–0.3%, and at most 5% past it.", writtenOn: "WATCH" },
    ...clock(7, "The base can extend and its pivot move."),
    { action: "STOP_WATCHING", predicate: onClose("below", "{baseLow}"), rationale: "The base's low.", writtenOn: "WATCH" },
    { action: "EXIT", predicate: sell, rationale: "Under the last contraction's low, or the base's low if within 8% of the buy. At least 1 ATR under the buy, never more than 8%.", writtenOn: "PROPOSAL" },
    trimAtHigh("The prior high above the buy, else twice the risk above the buy."),
    { action: "REVIEW", predicate: afterBuy(28), rationale: "20 sessions. No progress in 10–20 sessions is a failed breakout.", writtenOn: "FILL" },
    { action: "REVIEW", predicate: { watch: "move", is: "above", value: "{riskPct}", variable: "entry" }, rationale: "One risk: (the buy price − the sell price) ÷ the buy price. Once it is up one risk, the run raises the sell price to the buy price.", writtenOn: "PROPOSAL" },
  ],
  MA_PULLBACK: [
    { action: "ENTER", predicate: near50, rationale: "The average the stock's pullbacks held (or the 20-day), only while it is rising.", writtenOn: "WATCH" },
    ...clock(7, "Re-checks that the average is still rising."),
    { action: "STOP_WATCHING", predicate: under50OnVolume, rationale: "A close below the 50-day on volume ends the pullback. It reads during the day.", writtenOn: "WATCH" },
    { action: "EXIT", predicate: sell, rationale: "The pullback's swing low, or 1 ATR under the average bought if that is higher; at least 1 ATR under the buy.", writtenOn: "PROPOSAL" },
    { action: "EXIT", predicate: under50OnVolume, rationale: "The pullback is over.", writtenOn: "FILL" },
    trimAtHigh("The prior high the pullback came from."),
    { action: "REVIEW", predicate: afterBuy(14), rationale: "10 sessions to reclaim the prior high.", writtenOn: "FILL" },
  ],
  PEAD: [
    { action: "ENTER", predicate: onClose("above", "{price}"), rationale: "Today's price, written on days 1–3 after a report with EPS 5%+ over, a revenue beat, guidance raised and reaction volume 2×+; not already 10% past the gap, never a beat the stock fell on.", writtenOn: "WATCH" },
    ...clock(7, "The first one after day 3 re-writes the stock on the pullback playbook or lets it go."),
    { action: "STOP_WATCHING", predicate: onClose("below", "{gapDayLow}"), rationale: "The gap day's low.", writtenOn: "WATCH" },
    { action: "EXIT", predicate: sell, rationale: "The gap day's low or 8% under the buy, whichever is higher; at least 1 ATR under the buy.", writtenOn: "PROPOSAL" },
    trimAtHigh("The prior high above the buy, else twice the risk above the buy."),
    { action: "REVIEW", predicate: afterBuy(60), rationale: "Hold 30–60 days.", writtenOn: "FILL" },
  ],
  EPISODIC_PIVOT: [
    { action: "REVIEW", fireMode: "ASK_NOW", predicate: { match: "all", conditions: [{ watch: "gap", value: 8 }, { watch: "volume", value: 3 }] }, rationale: "The run reads the news and writes the triggers below.", writtenOn: "WATCH" },
    { action: "ENTER", predicate: onClose("above", "{gapDayHigh}"), rationale: "The gap day's high; on a day-2 hold above the gap day's middle, today's price.", writtenOn: "WATCH" },
    { action: "REVIEW", fireMode: "ASK_NOW", predicate: onClose("below", "{gapDayMid}"), rationale: "The gap day's middle.", writtenOn: "WATCH" },
    ...clock(7, "Moves the levels to the finished gap day."),
    { action: "STOP_WATCHING", predicate: onClose("below", "{gapDayLow}"), rationale: "The gap day's low.", writtenOn: "WATCH" },
    { action: "EXIT", predicate: sell, rationale: "The gap day's low, at least 1 ATR under the buy.", writtenOn: "PROPOSAL" },
    // The watch triggers come off at the fill, so the holding's own copy comes with the buy.
    { action: "REVIEW", fireMode: "ASK_NOW", predicate: onClose("below", "{gapDayMid}"), rationale: "The gap day's middle, on the holding.", writtenOn: "PROPOSAL" },
    { action: "REVIEW", predicate: afterBuy(7), rationale: "5 sessions. After 3–5 sessions of progress, the run takes a partial.", writtenOn: "FILL" },
  ],
  COMPOUNDER_ACCUMULATION: [
    { action: "ENTER", predicate: { match: "all", conditions: [{ watch: "price", is: "above", value: "{pivot}", settings: { close: true } }, { watch: "volume", value: 1.5 }] }, rationale: "The base's pivot, on volume.", writtenOn: "WATCH" },
    { action: "ENTER", predicate: near50, rationale: "Only while the 50-day is rising.", writtenOn: "WATCH" },
    { action: "ENTER", predicate: { watch: "price", is: "above", variable: "sma50" }, rationale: "Back above the 50-day, only while it is rising.", writtenOn: "WATCH" },
    ...clock(30, "The compounder's own clock."),
    { action: "STOP_WATCHING", predicate: onClose("below", "{low52}"), rationale: "The 52-week low.", writtenOn: "WATCH" },
    { action: "EXIT", predicate: sell, rationale: "Under the last base's low or swing low, at most 25% under the buy, at least the playbook's ATR distance under it.", writtenOn: "PROPOSAL" },
    { action: "REVIEW", predicate: afterBuy(60), rationale: "The business checkpoint.", writtenOn: "FILL" },
    { action: "ADD", predicate: { watch: "move", is: "above", value: 7, variable: "entry" }, rationale: "The second half.", writtenOn: "FILL" },
  ],
  MOMENTUM_FLAG: [
    { action: "ENTER", predicate: { match: "all", conditions: [{ watch: "price", is: "above", value: "{flagHigh}", settings: { close: true } }, { watch: "volume", value: 1.5 }] }, rationale: "The flag's high.", writtenOn: "WATCH" },
    ...clock(7, "Re-checks the flag."),
    { action: "STOP_WATCHING", predicate: onClose("below", "{flagLow}"), rationale: "The flag's low.", writtenOn: "WATCH" },
    { action: "EXIT", predicate: sell, rationale: "The buy day's low, at most one ADR under the buy.", writtenOn: "PROPOSAL" },
    { action: "REVIEW", predicate: afterBuy(7), rationale: "5 sessions.", writtenOn: "FILL" },
  ],
  RSI2_BOUNCE: [
    { action: "ENTER", predicate: { match: "all", conditions: [{ watch: "price", is: "above", variable: "sma200" }, { watch: "rsi", is: "below", value: 10, settings: { period: 2 } }] }, rationale: "A flush in an uptrend.", writtenOn: "WATCH" },
    ...clock(7, "Re-checks the uptrend."),
    { action: "STOP_WATCHING", predicate: { watch: "price", is: "below", variable: "sma200" }, rationale: "It reads during the day.", writtenOn: "WATCH" },
    { action: "EXIT", predicate: sell, rationale: "The flush's low.", writtenOn: "PROPOSAL" },
    { action: "EXIT", predicate: { watch: "price", is: "below", variable: "sma200" }, rationale: "The uptrend is over.", writtenOn: "FILL" },
    { action: "EXIT", predicate: { watch: "rsi", is: "above", value: 65, settings: { period: 2 } }, rationale: "The bounce is done.", writtenOn: "FILL" },
    { action: "REVIEW", predicate: afterBuy(7), rationale: "5 sessions.", writtenOn: "FILL" },
  ],
  RS_52W_HIGH: [
    { action: "REVIEW", predicate: { match: "all", conditions: [{ watch: "move", is: "near", value: 5, variable: "high52" }, { watch: "strength", value: 0, settings: { window: "3M" } }] }, rationale: "A screen: the run writes the breakout's, flag's or pullback's triggers.", writtenOn: "WATCH" },
  ],
  INSIDER_CLUSTER: [
    { action: "REVIEW", predicate: { watch: "insiders", value: 3, settings: { days: 30 } }, rationale: "A screen: the run writes the breakout's or pullback's triggers.", writtenOn: "WATCH" },
    { action: "EXIT", predicate: sell, rationale: "The lowest insider purchase price, or 12% under the buy if that is higher.", writtenOn: "PROPOSAL" },
  ],
  ESTIMATE_REVISION: [],
  SECTOR_ROTATION: [],
};
