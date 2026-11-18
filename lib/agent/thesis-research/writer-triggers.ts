/**
 * writer-triggers.ts — the triggers the Writer's save writes. The Writer
 * names the playbook and writes no trigger: the save writes that playbook's
 * watch triggers, each price from the chart the Writer was shown
 * (watchTriggers, the machinery the fill uses), and the Writer's own review
 * from look_again_price / look_again_date.
 *
 * On a refresh of a stock we watch, its watch triggers come off (a buy, a Stop
 * watching line, a playbook's watch trigger) and the playbook's go on, as at
 * the fill: a trigger the owner wrote stays, and the playbook's of the same
 * kind is not written. A PASS writes no playbook trigger and takes none off.
 * A refresh that would leave nothing on the stock is sent back to the Writer.
 * What isn't written (a template whose price the chart doesn't have, the
 * owner's trigger kept) goes back to the Writer and onto the stock as a "Not
 * applied" line.
 */
import { asWrittenTrigger, PLAYBOOK_UNREAD, watchTriggers } from "@/lib/agent/knowledge/playbooks";
import type { Template } from "@/lib/agent/knowledge/playbook-templates";
import { collision } from "@/lib/agent/triggers/ops";
import { sentenceOf } from "@/lib/agent/triggers/condition";
import type { Trigger } from "@/lib/agent/triggers/types";
import type { PriceStructure } from "@/lib/market-data/price-structure";
import type { DroppedItem, ThesisDecisionInput, WriterDecisionInput } from "./decision";

export interface WriterTriggerInputs {
  /** The named playbook's templates; null when the account's playbooks couldn't be read. */
  templates: Template[] | null;
  /** The chart the Writer was shown. */
  chart: PriceStructure | null;
  /** The live price: a look-again price below it is "if below", above it "if above". */
  price: number | null;
  today: Date;
  /** On a refresh, the stock's triggers now. */
  existing: { triggers: Trigger[]; direction: string | null } | null;
}

/** A watch's own trigger: the buy, its Stop watching line, a playbook's watch trigger (as the fill reads it). */
const watchesFor = (t: Trigger) => t.action === "ENTER" || t.action === "STOP_WATCHING" || t.playbook === "WATCH";

export function writerTriggers(d: WriterDecisionInput, at: WriterTriggerInputs): { decision: ThesisDecisionInput; notWritten: DroppedItem[]; nothingLeft: boolean } {
  // The call reaches the save as the model wrote it: a trigger field it sends anyway is not the Writer's to write.
  const { look_again_price: price, look_again_date: date, look_again_why: why, ...thesis } = d;
  for (const k of ["triggers", "add_triggers", "edit_triggers", "remove_trigger_ids"]) delete (thesis as Record<string, unknown>)[k];
  const notWritten: DroppedItem[] = [];
  const pass = d.direction === "PASS";

  // The playbook's watch triggers, each price from the chart.
  let playbook: Trigger[] = [];
  if (!pass && d.setup_id) {
    if (at.templates == null) notWritten.push({ field: "setup_id", why: `the ${d.setup_id} playbook's watch triggers`, reason: PLAYBOOK_UNREAD });
    else {
      const w = watchTriggers(at.templates, at.chart);
      playbook = w.triggers;
      for (const s of w.skipped) notWritten.push({ field: "setup_id", why: `the playbook's ${s.sentence}`, reason: `the chart had no ${s.missing.join(", ")}` });
    }
  }

  // On a refresh, the watch triggers the owner didn't write come off; one the owner wrote keeps the playbook's of its kind off.
  const removed = !pass && at.existing ? at.existing.triggers.filter((t) => watchesFor(t) && t.source !== "PRINCIPAL") : [];
  const staying = at.existing ? at.existing.triggers.filter((t) => !removed.includes(t)) : [];
  playbook = playbook.filter((t) => {
    const his = collision(staying, t, at.existing?.direction ?? d.direction);
    if (his?.source !== "PRINCIPAL") return true;
    notWritten.push({ field: "setup_id", why: `the playbook's ${sentenceOf(t)}`, reason: `your ${sentenceOf(his)} is kept` });
    return false;
  });

  // The Writer's own review: a price, or a day. Its reason is the Writer's, or the review isn't written.
  const own: Array<Record<string, unknown>> = [];
  if (price != null) {
    const ref = at.price ?? at.chart?.price ?? null;
    if (ref == null) notWritten.push({ field: "look_again_price", why: `the review at $${price}`, reason: "the save had no price to tell which side of it the stock is" });
    else if (!why?.trim()) notWritten.push({ field: "look_again_why", why: `the review at $${price}`, reason: "it has no reason (look_again_why)" });
    else own.push({ action: "REVIEW", predicate: { watch: "price", is: price < ref ? "below" : "above", value: price }, rationale: why });
  }
  if (date) {
    const todayEt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(at.today);
    const days = Math.round((Date.parse(date) - Date.parse(todayEt)) / 86_400_000);
    if (!(days >= 1 && days <= 365)) notWritten.push({ field: "look_again_date", why: `the review on ${date}`, reason: "a day 1 to 365 days from today is needed" });
    else if (!why?.trim()) notWritten.push({ field: "look_again_why", why: `the review on ${date}`, reason: "it has no reason (look_again_why)" });
    else own.push({ action: "REVIEW", predicate: { watch: "repeat", value: days }, rationale: why });
  }

  const written = [...playbook.map(asWrittenTrigger), ...own];
  const decision: ThesisDecisionInput = at.existing
    ? { ...thesis, ...(written.length ? { add_triggers: written as never } : {}), ...(removed.length ? { remove_trigger_ids: removed.map((t) => t.id) } : {}) }
    : { ...thesis, ...(written.length ? { triggers: written as never } : {}) };
  // A refresh that would leave a view with nothing on it is sent back, as a new stock's is (decision.ts).
  const nothingLeft = !pass && at.existing != null && staying.length + written.length === 0;
  return { decision, notWritten, nothingLeft };
}
