/**
 * The builder and the editor print one shared block (how to ask, how to pick
 * a playbook, the fence, the watchlist, the seven parts, the formatting), and
 * each prompt says each of those once. Neither calls an industry or a theme
 * part of the fence: the fence is the cap band, the sectors and the exclusions.
 */
import { ANALYST_CHAT_RULES, BUILDER_SYSTEM_PROMPT, buildEditorSystemPrompt, MODES } from "@/lib/agent/modes";

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
    "every watchlist ticker is checked": /one you checked with get_stock_data in this conversation/,
  };
  for (const [mode, prompt] of Object.entries(PROMPTS)) {
    for (const [rule, said] of Object.entries(RULES)) expect({ mode, rule, times: times(prompt, said) }).toEqual({ mode, rule, times: 1 });
  }
});

it("a watchlist ticker is one the user named or one checked, not only one off the day's lists", () => {
  // A compounder could only seed from the day's movers (one name in one run; a
  // wrong one for its theme in another), and "from memory" was refused even when checked.
  for (const said of [/came back from get_market_movers \/ get_earnings_calendar and that you then checked/, /pad the list from memory/, /seed the watchlist from names the USER named/]) {
    expect({ said: said.source, found: said.test(PROMPTS.builder) }).toEqual({ said: said.source, found: false });
  }
});

it("the builder names every seed source it has wherever it names one, and each prompt names only tools it has", () => {
  // A catalyst build that seeded from get_catalyst_calendar broke a rule that named only the other two.
  const SEEDS = ["get_market_movers", "get_earnings_calendar", "get_catalyst_calendar"];
  expect(SEEDS.filter((t) => !(MODES.builder.toolAllowlist as readonly string[]).includes(t))).toEqual([]);
  const naming = PROMPTS.builder.split("\n").filter((l) => l.includes("get_market_movers") && l.includes("get_earnings_calendar"));
  expect(naming.length).toBeGreaterThan(0);
  for (const line of naming) expect({ line, catalyst: line.includes("get_catalyst_calendar") }).toEqual({ line, catalyst: true });
  expect(PROMPTS.builder).toContain("**get_catalyst_calendar**");
  for (const [mode, prompt] of Object.entries(PROMPTS)) {
    const has = new Set([...(MODES[mode as "builder" | "editor"].toolAllowlist ?? []), "suggest_config"]);
    const named = [...new Set(prompt.match(/\b(get_[a-z_]+|list_analysts|read_knowledge_library|ask_question|web_search|run_screen)\b/g))];
    expect({ mode, missing: named.filter((t) => !has.has(t)) }).toEqual({ mode, missing: [] });
  }
});

it("the playbook question is asked only when more than one playbook fits", () => {
  // The builder skips ask_question on a clear spec (Step 1, rule 1), and its
  // playbook step then asked anyway: 5 of 7 runs given a plainly named style.
  for (const [mode, prompt] of Object.entries(PROMPTS)) {
    const asks = prompt.split("\n").filter((l) => l.includes("each candidate as an option"));
    expect(asks.length).toBeGreaterThan(0);
    for (const line of asks) expect({ mode, line, conditional: /more than one fits/.test(line) }).toEqual({ mode, line, conditional: true });
    expect(prompt).toContain("When one fits, deep-read it and go on.");
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

it("the builder shows its draft by calling suggest_config, never by writing it into the chat", () => {
  // In 5 of 9 runs the builder wrote the whole draft into the chat and asked
  // "Shall we proceed?", and the panel stayed empty.
  expect(PROMPTS.builder).toContain("never write the strategy, the description or the watchlist into the chat, and never ask whether to go ahead: call suggest_config.");
});
