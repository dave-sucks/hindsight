/**
 * T1 of the trigger plan (2026-11-19): every text an agent is sent that
 * changed, as it read before and as it reads now. The Writer's save carries no
 * trigger (writer.md, holding-refresh.md, research-rules.md), the account's
 * report rule is said as it is, the screen's review adds a playbook's triggers
 * by reference, the playbooks read in plain words, and each playbook trigger
 * is one line with its reference and no JSON. The engine tests apply these to
 * the goldens as a documented change, as they apply the tool renames.
 */
import { sentenceOf } from "@/lib/agent/triggers/condition";
import { fireModeLabel } from "@/lib/agent/triggers/fire-mode";
import type { Trigger } from "@/lib/agent/triggers/types";
import { SETUPS, templatePlaceholders, type Placeholder } from "@/lib/agent/knowledge/setups";
import { TRIGGER_LIST_NAME, WRITTEN_ON, type WrittenOn, type Template } from "@/lib/agent/knowledge/playbook-templates";
import { asWritten, playbookTriggerText } from "@/lib/agent/knowledge/playbooks";

/** The sentences of the Writer's and the Holding refresh's instructions, and the situation that adds a playbook's triggers. */
const SENTENCES: Array<[string, string]> = [
  ["One research note, then one submit_thesis call.\n", "One research note, then one submit_thesis call; after the save, edit_triggers.\n"],
  [
    `- THE PLAYBOOK WRITES THE TRIGGERS. Once the research gives you a view, name the playbook that fits (setup_id) and write every one of its watch triggers (YOUR PLAYBOOKS), each with "playbook": "WATCH", exactly as listed: the trigger it shows, its action, condition and fireMode as they are ("within 2% of the 50-day average" stays that, never a price; no fireMode where it shows none), and every {chart number} replaced by its price from this stock's chart today (the Price structure block, chart.), never a round number, never a feel. A trigger whose price the chart doesn't have yet (an episodic pivot's buy before its gap) is left out, and the playbook's review that wakes a run is written instead. Each gets its reason, with the price in it. A stock has triggers and nothing else:
  - a "Stop watching if below" trigger's reason opens with what a close below it would say about core_belief, in one plain sentence, then the chart, with the price. It never sells: the holding's sell price comes with the buy;
  - a trigger of your own (an earnings review, a price you'd look again at) goes next to them, without "playbook";
  If no playbook fits, name none: the view stays with no buy (NO PRICE WORTH WAITING FOR YET, below) — not a PASS, and not a buy at an invented price.`,
    `- THE PLAYBOOK WRITES THE TRIGGERS. Once the research gives you a view, name the playbook that fits (setup_id): the save writes every one of its watch triggers (YOUR PLAYBOOKS), each priced from this stock's chart today. A trigger whose price the chart doesn't have yet (an episodic pivot's buy before its gap) is not written; the playbook's review that wakes a run is. A stock has triggers and nothing else. If no playbook fits, name none: the view stays with no buy (NO PRICE WORTH WAITING FOR YET, below) — not a PASS, and not a buy at an invented price.
- AFTER THE SAVE, TAILOR THEM with edit_triggers, with your reason for every change: change or remove one that doesn't fit this stock, by its id; add one of your own (an earnings review, a price you'd look again at). A price is a chart key ({swingLow}) whose number code writes, or a line (the 50-day average), never a typed number. If they fit, say so in one line.
  - a "Stop watching if below" trigger you write or change: its reason opens with what a close below it would say about core_belief, in one plain sentence, then the chart, with the price. It never sells: the holding's sell price comes with the buy.`,
  ],
  [
    `- NO PRICE WORTH WAITING FOR YET (the buying window opens later, the chart hasn't formed, you want to price it after the report) → write no buy and no "Stop watching if below". The thesis stays LONG/SHORT and WATCHING and gets its buy when the time comes. It MUST carry the review that brings it back, in \`triggers\`: a review at the price you'd look again, or a short day-count review. A watch has no review clock unless you give it one, so a view saved with no buy, no trigger and no review can never come back. "I want to buy the pullback rather than buy here" IS a playbook: write it on MA_PULLBACK.`,
    `- NO PRICE WORTH WAITING FOR YET (the buying window opens later, the chart hasn't formed, you want to price it after the report) → no buy and no "Stop watching if below": name no playbook, or remove them after the save. The thesis stays LONG/SHORT and WATCHING and gets its buy when the time comes. It MUST carry the review that brings it back: look_again on the save (the day after the next report, or a day), or a review at the price you'd look again, added with edit_triggers. A watch has no review clock unless its playbook or you give it one, so a view saved with no buy, no trigger and no review can never come back. "I want to buy the pullback rather than buy here" IS a playbook: name MA_PULLBACK.`,
  ],
  ["- Nothing is added for you: a watch carries the triggers you write and no others, no review clock included.", "- A watch carries its playbook's watch triggers and the ones you add, and no others, no review clock included."],
  [
    "- Taking the buy off on a refresh (no price worth holding): send remove_trigger_ids naming the buy and Stop watching ids from the stock's row, keeping ≥1 REVIEW wake.",
    "- Taking the buy off on a refresh (no price worth holding): remove the buy and the Stop watching trigger with edit_triggers, by their ids on the stock's row, keeping ≥1 REVIEW wake.",
  ],
  ["one deep-research note on the stock the first message names, then one submit_thesis call.", "one deep-research note on the stock the first message names, then one submit_thesis call; after the save, edit_triggers."],
  [
    "The holding's triggers came with the buy and at the fill; edit them by id only where the research changed one.",
    "The holding's triggers came with the buy and at the fill; after the save, change one with edit_triggers, by its id and with your reason, only where the research changed it.",
  ],
  ['- It carries its "Sell if below" trigger already. Most refreshes need no trigger ops at all.', '- It carries its "Sell if below" trigger already. Most refreshes change no trigger.'],
  [
    'Move the "Sell if below" trigger (edit_triggers, by its id on the stock\'s row) up, never down.',
    'Move the "Sell if below" trigger up, never down: edit_triggers, by its id on the stock\'s row, to a chart key ({swingLow}).',
  ],
  [
    "The account rules already give EVERY name a heads-up and a review on any beat or miss, so most theses need none of these.",
    "The account rules already give EVERY name a heads-up 3 days before each report and one review within 1 day after it, so most theses need none of these.",
  ],
  [
    "When it returns accepted, STOP. Do not write anything after acceptance.",
    "When it returns accepted, STOP: the stock's triggers as saved come to you next, for edit_triggers.",
  ],
  [
    `write that playbook's watch triggers with edit_triggers' add and name it (setup_id), each with "playbook": "WATCH", exactly as listed, every {chart number} replaced by its price from this stock's chart today; one whose price the chart doesn't have yet is left out.`,
    "add that playbook's watch triggers with edit_triggers' add, each by its reference (W1, W2…), and name it (setup_id); code prices each from this stock's chart today, and one whose price the chart doesn't have yet comes back not written.",
  ],
];

/** The playbooks' words before the plain-words pass (setups.ts). */
const PLAIN_WORDS: Array<[string, string]> = [
  ["Trend Template passes (chart.trendTemplate — price above a rising 150/200-day, 50-day above both, within 25% of the 52-week high, 30%+ off the low, beating SPY)", "Trend Template passes (price above a rising 150- and 200-day, the 50-day above both, within 25% of the 52-week high, 30%+ off the low, beating SPY)"],
  ["A base of 20+ sessions (chart.base), 15–25% deep at most", "A base of 20+ sessions, 15–25% deep at most"],
  ["breakouts fail most in a cautious one (playbook Part C)", "breakouts fail most in a cautious one"],
  ["Risk-based (Part E4)", "Sized by risk"],
  ["Average daily range (chart.adr20Pct) ≥ 3–5%", "An average daily range of 3–5% or more"],
  ["No seat runs this today (DAV-245 ruling 3).", "No analyst runs this today."],
  ["Relative strength vs SPY positive over 3 months (chart.relativeStrength.vsSpy.m3 > 0)", "Beating SPY over the last 3 months"],
  ["Within 5% of the 52-week high (chart.range.pctBelow52wHigh ≤ 5)", "Within 5% of the 52-week high"],
  ["days out (Thesis.catalystDate)", "days out (the stock's event date)"],
  ["Half the normal risk (DAV-245 ruling 2).", "Half the normal risk."],
];

/** Where each key came from, as the playbook text said before T1. */
const OLD_PLACEHOLDERS: Record<string, string> = {
  "{pivot}": "chart.base.pivot — the base's high; add 0.1–0.3% buffer",
  "{pivotChase}": "chart.base.pivot × 1.05 — the chase ceiling",
  "{flagHigh}": "chart.range.high20 — the flag's high (or the last swing high inside the flag)",
  "{gapDayHigh}": "chart.gaps[0].high — day-1 high of the gap",
  "{gapDayMid}": "chart.gaps[0].mid — the gap-day midpoint (a hold above it on day 2 is the entry)",
  "{gapDayLow}": "chart.gaps[0].low — the gap-day low, the market's own line",
  "{swingLow}": "chart.swings.lastLow.price",
  "{high20}": "chart.range.high20 — the 20-day high",
  "{baseLow}": "chart.base.low — the base's low",
  "{priorHigh}": "chart.swings.lastHigh.price — the prior high above the buy",
  "{priorHighOrTwiceRisk}": "chart.swings.lastHigh.price when it is above the buy, else the buy price + 2 × (the buy price − the sell price)",
  "{low52}": "chart.range.low52w — the 52-week low",
  "{flagLow}": "chart.range.low20 — the flag's low",
  "{price}": "chart.price — today's price",
  "{sellPrice}": "the sell price the run names with the buy (place_trade's sell_if_below), by its trigger's own reason",
  "{riskPct}": "(the buy price − the sell price) ÷ the buy price, as a % — one risk",
};

/** Volume, strength and a gap said "at least" in a sentence until 2026-11-20; they say "above" now, as the form does. */
const saidAtLeast = (s: string) => s.replace(/above (?=[-\d.]+(?:× normal volume|% gap up| points ahead))/g, "at least ");

/** A playbook's list as playbookTriggerText printed it before T1: each trigger's sentence, its JSON as written, its reason. */
function oldPlaybookTriggerText(templates: Template[], on: WrittenOn): string[] {
  const mine = templates.filter((t) => t.writtenOn === on);
  if (!mine.length) return [`${TRIGGER_LIST_NAME[on]}: none.`];
  const marks = [...new Set(mine.flatMap((t) => templatePlaceholders(t.predicate)))] as Placeholder[];
  return [
    `${TRIGGER_LIST_NAME[on]}:`,
    ...mine.map((t) => {
      const sized = on === "PROPOSAL" && t.trimPct != null ? { trimPct: t.trimPct } : {};
      const written = { action: t.action, predicate: asWritten(t.predicate), ...(t.fireMode ? { fireMode: t.fireMode } : {}), ...sized };
      return `- ${saidAtLeast(sentenceOf(t as unknown as Trigger))}${t.fireMode ? ` (${fireModeLabel(t.fireMode, t.action)})` : ""}: ${JSON.stringify(written)} — ${t.rationale}`;
    }),
    ...(marks.length ? [`Where each chart number comes from: ${marks.map((m) => `${m} ${OLD_PLACEHOLDERS[m]}`).join("; ")}.`] : []),
  ];
}

/** Each catalog playbook's trigger lists, old to new, whole: joined as the playbooks block joins them ("\n  ") and as read_knowledge_library does ("\n"). */
function playbookLists(): Array<[string, string]> {
  const pairs = new Map<string, string>();
  for (const s of SETUPS) {
    for (const on of WRITTEN_ON) {
      for (const sep of ["\n  ", "\n"]) {
        const was = oldPlaybookTriggerText(s.triggers, on).join(sep);
        const is = playbookTriggerText(s.triggers, on).join(sep);
        if (was === is) continue;
        if (pairs.has(was) && pairs.get(was) !== is) throw new Error(`t1-text: one old list reads two ways now: ${was.slice(0, 120)}`);
        pairs.set(was, is);
      }
    }
  }
  return [...pairs];
}

export const T1_TEXT: ReadonlyArray<readonly [string, string]> = [...SENTENCES, ...PLAIN_WORDS, ...playbookLists()];
