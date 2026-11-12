/**
 * prompt-blocks.ts — an agent's instructions cut into the parts they are
 * built from, at the openers the prompt builders print, each with its
 * Framework part for its color (components/docs/framework/swatch.ts):
 *
 *   - the analyst's brief: "## Analyst: <name>", then its strategy, its
 *     Rules and its Setups (lib/agent/analyst-brief.ts);
 *   - the house rules: HOUSE_RULES itself (lib/agent/house-rules.ts);
 *   - the Market and portfolio block: "## Market and portfolio" to the next
 *     "## " heading or ═══ banner, one part, its "### " parts its sections;
 *   - on a trigger run, the stock's row under its "$T, its row (get_theses)"
 *     banner (system-prompts/intraday-tactical.ts), and inside the row's
 *     `said`, its notes, then its Activity lines from "WHAT'S BEEN SAID ON $T".
 *
 * The rest is the agent's own instructions, one part. A prompt with none of
 * the openers is one part. The parts' sizes add up to the prompt's. Pure.
 */
import { HOUSE_RULES } from "@/lib/agent/house-rules";

/** Its Framework part, for its color (components/docs/framework/swatch.ts). */
export type PromptPart = "job" | "house" | "analyst" | "portfolio" | "read";

export interface PromptBlock {
  label: string;
  part: PromptPart;
  text: string;
  /** Characters of the prompt it covers, as sent. */
  chars: number;
  /** Its own sections, when the block has headings of its own (the Market and portfolio block's parts). */
  sections?: Array<{ label: string; text: string }>;
}

/** A span of the prompt one part covers. `text` replaces the span when shown (a row with its said cut out); `of` ties a part to the claim it sits in. */
interface Claim {
  start: number;
  end: number;
  label: string;
  part: PromptPart;
  text?: string;
  chars?: number;
  of?: Claim;
  sections?: PromptBlock["sections"];
}

const ANALYST = "## Analyst: ";
export const MARKET = "## Market and portfolio";
const SAID = "WHAT'S BEEN SAID ON $";
const ROW_BANNER = /(?:^|\n)(═{10,}\n\$([A-Z0-9.\-]+), its row \(get_theses\)\n═{10,}\n)/;

/** Where a line starting with `prefix` begins, from `from`; -1 when none. */
function lineAt(text: string, prefix: string, from = 0): number {
  let i = text.indexOf(prefix, from);
  while (i > 0 && text[i - 1] !== "\n") i = text.indexOf(prefix, i + 1);
  return i;
}

const paragraphEnd = (text: string, i: number) => (text.indexOf("\n\n", i) < 0 ? text.length : text.indexOf("\n\n", i));

/** `end` moved back past trailing whitespace, so a part ends on its own last line. */
function trimmed(text: string, start: number, end: number): number {
  while (end > start && /\s/.test(text[end - 1])) end--;
  return end;
}

/** The next line after `from` that opens a section: a "## " heading or a ═══ banner. */
function nextSection(text: string, from: number): number {
  const m = /\n(## |═{10,})/.exec(text.slice(from));
  return m ? from + m.index : text.length;
}

function analystBrief(text: string): Claim[] {
  const start = lineAt(text, ANALYST);
  if (start < 0) return [];
  // Its Rules, before the next "## " heading; a brief without them claims nothing.
  const rules = text.indexOf("\n\nRules:\n", start);
  const next = lineAt(text, "## ", start + ANALYST.length);
  if (rules < 0 || (next >= 0 && rules > next)) return [];
  let end = paragraphEnd(text, rules + 2);
  if (text.startsWith("\n\nSetups:\n", end)) end = paragraphEnd(text, end + 2);
  return [{ start, end, label: text.slice(start + 3, text.indexOf("\n", start)).trim(), part: "analyst" }];
}

function houseRules(text: string): Claim[] {
  const at = text.indexOf(HOUSE_RULES);
  return at < 0 ? [] : [{ start: at, end: at + HOUSE_RULES.length, label: "House rules", part: "house" }];
}

function marketBlock(text: string): Claim[] {
  const start = lineAt(text, MARKET);
  if (start < 0) return [];
  const end = trimmed(text, start, nextSection(text, start + MARKET.length));
  const parts: number[] = [];
  for (let i = lineAt(text, "### ", start); i >= 0 && i < end; i = lineAt(text, "### ", i + 4)) parts.push(i);
  // Its "### " parts are its sections; the block's own heading goes with the first.
  const sections = parts.map((p, k) => ({ label: text.slice(p + 4, text.indexOf("\n", p)).trim(), text: text.slice(k === 0 ? start : p, parts[k + 1] ?? end) }));
  return [{ start, end, label: "Market and portfolio", part: "portfolio", ...(sections.length ? { sections } : {}) }];
}

function stockRow(text: string): Claim[] {
  const m = ROW_BANNER.exec(text);
  if (!m) return [];
  const T = m[2];
  const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
  const body = start + m[1].length;
  // The row is printed with JSON.stringify(row, null, 2): it closes on a line of its own.
  const close = text[body] === "{" ? text.indexOf("\n}", body) : -1;
  const end = close < 0 ? paragraphEnd(text, body) : close + 2;
  const row: Claim = { start, end, label: `$${T} row`, part: "read" };
  let said: unknown;
  try {
    said = close < 0 ? null : (JSON.parse(text.slice(body, end)) as { said?: unknown }).said;
  } catch {
    said = null;
  }
  const own = text.slice(start, end);
  const sent = typeof said === "string" && said.trim() ? JSON.stringify(said) : "";
  if (!sent || !own.includes(sent)) return [row];
  const said_ = said as string;
  const cut = said_.indexOf(SAID);
  const head = cut < 0 ? said_ : said_.slice(0, cut);
  const tail = cut < 0 ? "" : said_.slice(cut);
  const names = [head.trim() && `Notes on $${T}`, tail.trim() && `Activity on $${T}`].filter(Boolean).join(" and ");
  row.text = own.replace(sent, () => JSON.stringify(`[See ${names}]`));
  row.chars = own.length - sent.length;
  // Their sizes as sent: each one's part of the row's JSON string, so together they are all of it.
  const both = head.trim() && tail.trim();
  const escaped = (s: string) => JSON.stringify(s).length - 2;
  const inside: Claim[] = [];
  if (head.trim()) inside.push({ start: end, end, label: `Notes on $${T}`, part: "read", text: head.trim(), chars: both ? escaped(head) + 1 : sent.length, of: row });
  if (tail.trim()) inside.push({ start: end, end, label: `Activity on $${T}`, part: "read", text: tail.trim(), chars: both ? escaped(tail) + 1 : sent.length, of: row });
  return [row, ...inside];
}

/** The parts of one prompt: the agent's own instructions first, then each other part in the order the prompt has it. */
export function promptBlocks(text: string): PromptBlock[] {
  const found = [...analystBrief(text), ...houseRules(text), ...marketBlock(text), ...stockRow(text)].sort((a, b) => a.start - b.start || a.end - b.end);
  // Two openers in one span (a strategy quoting a heading): the first keeps it, and a part goes with its claim.
  const claims: Claim[] = [];
  for (const c of found) {
    const last = claims[claims.length - 1];
    if (c.of ? !claims.includes(c.of) : last && c.start < last.end) continue;
    claims.push(c);
  }
  if (!claims.length) return [{ label: "Instructions", part: "job", text, chars: text.length }];
  const own: string[] = [];
  let chars = 0;
  let at = 0;
  for (const c of claims) {
    if (c.end === c.start) continue;
    const gap = text.slice(at, c.start);
    if (gap.trim()) own.push(gap.trim());
    chars += gap.length;
    own.push(`[See ${c.label}]`);
    at = c.end;
  }
  if (text.slice(at).trim()) own.push(text.slice(at).trim());
  chars += text.length - at;
  return [
    { label: "Instructions", part: "job", text: own.join("\n\n"), chars },
    ...claims.map((c) => ({ label: c.label, part: c.part, text: c.text ?? text.slice(c.start, c.end), chars: c.chars ?? c.end - c.start, ...(c.sections ? { sections: c.sections } : {}) })),
  ];
}
