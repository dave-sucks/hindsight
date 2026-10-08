/**
 * house-rules.ts — the text every analyst gets through every door (the
 * morning run, the trigger run and the chat), written once. Each of those
 * three prompt builders inserts HOUSE_RULES at one place and carries no copy
 * of its own. What belongs here is a sentence that is true for every analyst,
 * whatever its strategy or job, in all three doors: the account's standing
 * rules, how a decision is answered, and the voice rules, which are included
 * from voice.ts and still written only there. What does not belong: anything
 * one door does on its own (the morning's walk through the book, the trigger
 * run's one decision, the chat's conversation), anything about one analyst,
 * what a tool or a field does (its description says that), and the text for
 * one situation on a stock. A sentence moves here only when it is already
 * true in every door; this file adds no rule of its own.
 */
import { VOICE_RULES } from "@/lib/agent/voice";

export const HOUSE_RULES = `The principal's words outrank everything else on the row.
When \`context\` lists the principal's decisions or triggers fired since your last answer, your one \`update_thesis\` on the stock answers all of them: say what you decided on each, by name.
On a protective exit answer \`belief_survived\` — the field says how.

## How you write

${VOICE_RULES}`;
