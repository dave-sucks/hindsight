/**
 * Every agent's request on every engine fixture case, as one text a case: its
 * instructions, its first message and (the chat) what rides on its newest
 * message. A change that moves words without editing them keeps every hash
 * (./requests.golden.json, ../moves.engine.test.ts).
 */
import { MORNING_CASES, asRunInput } from "./morning-run-cases";
import { TRIGGER_CASES, TRIGGER_KICKOFF } from "./trigger-run-cases";
import { WRITER_CASES, WRITER_MESSAGE } from "./writer-cases";
import { CHAT_CASES } from "./chat-cases";
import { dailyRunRequest } from "@/lib/agent/system-prompt";
import { triggerRunRequest } from "@/lib/agent/system-prompts/intraday-tactical";
import { writerRequest } from "@/lib/agent/run-thesis-writer";
import { chatNewest, chatRequest } from "@/lib/agent/system-prompts/chat";
import { analystsText } from "@/lib/agent/context/the-analysts";
import { AGENTS } from "../agents";
import { AGENT_SAMPLES } from "@/lib/docs/agent-samples";

const NOW = new Date("2026-11-17T15:55:00Z");
const text = (r: { instructions: string; message: string }, newest?: { texts: string[] }) => [r.instructions, r.message, ...(newest?.texts ?? [])].join("\n\n=====\n\n");

export function sentRequests(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [n, c] of Object.entries(MORNING_CASES)) {
    const cc = c as { analyst: never; runInput: unknown; pieces?: never };
    out[`morning.${n}`] = text(dailyRunRequest(cc.analyst, { ...asRunInput(cc.runInput), portfolioPieces: cc.pieces ?? undefined }, NOW));
  }
  for (const [n, c] of Object.entries(TRIGGER_CASES)) {
    const { pieces, ...rest } = c as Record<string, unknown>;
    out[`trigger.${n}`] = text(triggerRunRequest({ ...(rest as unknown as Parameters<typeof triggerRunRequest>[0]), portfolioPieces: (pieces as never) ?? null }, { more: `${TRIGGER_KICKOFF.contextSuffix}${TRIGGER_KICKOFF.coFiredSuffix}` }, NOW));
  }
  for (const [n, c] of Object.entries(WRITER_CASES)) {
    const o = c as Parameters<typeof writerRequest>[0];
    out[`writer.${n}`] = text(writerRequest({ ...o, stockRow: o.existingThesis ? { stock: "CASE" } : null }, WRITER_MESSAGE, NOW));
  }
  for (const [n, c] of Object.entries(CHAT_CASES)) {
    const o = c as { scopedAnalyst: never; room?: never; roomLines?: string[] };
    out[`chat.${n}`] = text(chatRequest({ scopedAnalyst: o.scopedAnalyst, room: o.room }), chatNewest(NOW, null, "PAPER", { book: o.scopedAnalyst ? "## The book\nb" : null, analysts: analystsText(o.roomLines ?? []) }));
  }
  for (const r of AGENTS) {
    const built = AGENT_SAMPLES[r.id]!.build(r);
    out[`sample.${r.id}`] = text(built.request, built.newest);
  }
  return out;
}
