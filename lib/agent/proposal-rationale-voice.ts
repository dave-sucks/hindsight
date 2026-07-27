/**
 * Shared VOICE guidance for the reasoning text the principal reads when
 * reviewing a trade proposal.
 *
 * This text becomes `Order.rationale` on an AWAITING_APPROVAL order and is
 * surfaced in exactly two principal-facing places:
 *   1. the proposal-pending approval email (lib/emails/trade-card.ts)
 *   2. the review sheet where the principal approves/declines
 *      (components/agent/sheets/ThesisSheet.tsx)
 *
 * The principal is a non-professional trader, so this reasoning must be
 * written to be UNDERSTOOD, not to sound like a desk note. Appended to the
 * schema .describe() of every tool field that feeds Order.rationale:
 *   - place_trade.entry_rationale   (buy proposals)
 *   - manage_position.reason        (add / trim / move-stop proposals)
 *   - close_position.notes          (sell / close proposals)
 *
 * Keep it a single source of truth — edit the voice HERE, not per-tool.
 */
export const PROPOSAL_RATIONALE_VOICE = `

VOICE — this reasoning is shown to the principal (a non-professional trader) in the approval email and the review sheet, so write it to be understood, not to impress:
- Lead with a one-sentence plain-English "why" (what you're doing and the core reason), then add the supporting detail.
- Use everyday words. When a trading term is genuinely needed (breakout, moving average, support/resistance, risk/reward, PEAD, trailing stop, etc.), gloss it in plain language the FIRST time it appears — e.g. "back above its 20-day moving average (its average price over the last month)".
- Keep the real numbers (entry/trigger, target, stop) but say what each one MEANS in plain terms — e.g. "target $X, where I'd take profit" and "stop $Y, where I'd sell to cap the loss (about Z% below entry)".
- Stay accurate and specific — this is educational, not dumbed-down or vague. No hype, no filler.`;
