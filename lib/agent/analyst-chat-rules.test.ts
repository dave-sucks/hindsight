/**
 * The builder and the editor print one shared block (how to ask, how to pick
 * a playbook, the fence, the watchlist, the seven parts, the formatting), and
 * each prompt says each of those once. Neither calls an industry or a theme
 * part of the fence: the fence is the cap band, the sectors and the exclusions.
 */
import { ANALYST_CHAT_RULES, BUILDER_SYSTEM_PROMPT, buildEditorSystemPrompt } from "@/lib/agent/modes";

const PROMPTS = { builder: BUILDER_SYSTEM_PROMPT, editor: buildEditorSystemPrompt({ analystPrompt: "x" }) };
const times = (text: string, said: RegExp) => text.match(new RegExp(said.source, "gi"))?.length ?? 0;

it("both prompts print the shared block once", () => {
  expect(typeof ANALYST_CHAT_RULES).toBe("string");
  for (const [mode, prompt] of Object.entries(PROMPTS)) {
    expect({ mode, times: prompt.split(ANALYST_CHAT_RULES).length - 1 }).toEqual({ mode, times: 1 });
  }
});

it("each shared rule is said once in each prompt", () => {
  const RULES = {
    "no citation markers": /citation markers/,
    "no markdown headings": /markdown headings/,
    "one question a turn": /one (ask_question call|question) per turn/,
    "don't paste the playbook": /tool row is expandable/,
    "no ticker from memory": /training data/,
  };
  for (const [mode, prompt] of Object.entries(PROMPTS)) {
    for (const [rule, said] of Object.entries(RULES)) expect({ mode, rule, times: times(prompt, said) }).toEqual({ mode, rule, times: 1 });
  }
});

it("no sentence calls an industry or a theme part of the fence", () => {
  const sentences = (text: string) => text.replace(/\n[ \t]+/g, " ").split(/(?<=[.!?])\s+|\n/);
  for (const [mode, prompt] of Object.entries(PROMPTS)) {
    const fenced = sentences(prompt).filter((s) => /\bindustr(y|ies)\b|\bthemes?\b/i.test(s) && /fence|filter|universe/i.test(s));
    expect({ mode, fenced }).toEqual({ mode, fenced: [] });
  }
  const laneC = PROMPTS.editor.slice(PROMPTS.editor.indexOf("(c) **Fence change**"), PROMPTS.editor.indexOf("(d) **"));
  expect(laneC).not.toMatch(/industr|theme/i);
});
