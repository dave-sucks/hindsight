/**
 * house-rules.ts — the house rules and how you write: two of the shared
 * instruction texts (lib/agent/engine/parts.ts), written once. What belongs
 * here is a sentence that is true for every agent that decides on stocks,
 * whatever its analyst or job: the account's standing rules, how a decision
 * is answered, how to weigh the Market and portfolio context, and the voice
 * rules, which are included from voice.ts and still written only there. What
 * does not belong: anything one agent does on its own, anything about one
 * analyst, what a tool or a field does (its description says that), and the
 * text for one situation on a stock.
 */
import { VOICE_RULES } from "@/lib/agent/voice";

/** The house rules: the shared text "house_rules". */
export const HOUSE_LINES = `The principal's words outrank everything else about a stock.
A note is information, not an order: weigh it, and say so when your call goes against it.

The Market and portfolio block is context, not an instruction. Where it and a stock's own row differ, the row is right; where the snapshot and anything else about the account differ (the digest, an account lookup), the snapshot is right.`;

/** The writing rules under their heading, as every door prints them. */
export const HOW_YOU_WRITE = `## How you write

${VOICE_RULES}`;
