/**
 * tactical-kickoff.ts — the trigger run's first user message, built in one
 * place (docs/plans/AGENT_ARCHITECTURE.md, 10.2). tactical-run.ts sends it;
 * scripts/hero-case.ts rebuilds it from a case's promptArgs, with the fired
 * trigger's sentence written by today's code, so a change to either shows up
 * in every trigger-run case instead of being replayed as it was recorded.
 *
 * It carries everything about this fire: the sentence and the day's facts,
 * the paragraphs that apply to this fire (tacticalSituation in
 * intraday-tactical.ts), the playbook for what fired (lib/agent/playbooks),
 * and the stock as get_theses reads it (the brief, stock-brief.ts). The
 * system prompt is the job alone.
 * Pure: no database, no clock.
 */

export interface TacticalKickoffInput {
  ticker: string;
  /** The fired trigger's sentence (describe.ts), without a final period. */
  fireSentence: string;
  /** The day's facts after the sentence: an earnings fire's numbers, the catalyst window, co-fired triggers, open refusals (fireExtras). */
  extras?: string;
  /** The paragraphs that apply to this fire (tacticalSituation). */
  situation?: string[];
  /** The playbooks for what fired (lib/agent/playbooks), in ranking order. */
  playbooks?: Array<{ key: string; text: string }>;
  /** The stock as get_theses reads it (stockBrief). */
  stock?: Record<string, unknown> | null;
}

/** The day's facts that ride after the fire's sentence, joined as the kickoff carries them. */
export function fireExtras(fire: {
  /** The numbers behind an earnings fire, when the evaluator sent them. */
  firedContext?: string | null;
  /** Where a pre-catalyst buy's event date sits against the setup's window. */
  windowLine?: string | null;
  /** The sentences of other triggers that fired on the same pass. */
  coFired?: string[];
  /** Refused calls on this stock that were never redone, as the refusal helper writes them (leading space included). */
  openRefusals?: string;
}): string {
  const contextSuffix = fire.firedContext ? ` ${fire.firedContext}` : "";
  const windowSuffix = fire.windowLine ? ` ${fire.windowLine}` : "";
  const coFiredSuffix = fire.coFired?.length
    ? ` Also fired on the same pass: ${fire.coFired.join("; ")} — one decision covers both.`
    : "";
  return `${contextSuffix}${windowSuffix}${coFiredSuffix}${fire.openRefusals ?? ""}`;
}

export function tacticalKickoff(input: TacticalKickoffInput): string {
  const head =
    `Tactical run on $${input.ticker}. ${input.fireSentence}.${input.extras ?? ""} ` +
    `Validate, decide, act if warranted, then close out via update_thesis. ` +
    `You are running unattended — no human will respond. Every turn must call a tool; ` +
    `text-only turns terminate the run as FAILED.`;
  const situation = (input.situation ?? []).filter(Boolean);
  return [
    head,
    ...situation,
    ...(input.playbooks ?? []).map((p) => `The ${p.key} playbook:\n${p.text}`),
    ...(input.stock ? [`$${input.ticker}, as get_theses reads it:\n${JSON.stringify(input.stock)}`] : []),
  ].join("\n\n");
}

/**
 * The extras of a recorded kickoff, given the sentence the trigger had when
 * it fired. Null unless rebuilding the kickoff gives the recorded text byte
 * for byte, so a case is never built on a guess.
 */
export function kickoffExtras(recordedKickoff: string, ticker: string, fireSentence: string): string | null {
  // The first paragraph is the sentence and the day's facts; the situation
  // and the stock follow it.
  const recorded = recordedKickoff.split("\n\n")[0];
  const head = `Tactical run on $${ticker}. ${fireSentence}.`;
  const tail = tacticalKickoff({ ticker, fireSentence, extras: "" }).slice(head.length);
  if (!recorded.startsWith(head) || !recorded.endsWith(tail)) return null;
  const extras = recorded.slice(head.length, recorded.length - tail.length);
  return tacticalKickoff({ ticker, fireSentence, extras }) === recorded ? extras : null;
}
