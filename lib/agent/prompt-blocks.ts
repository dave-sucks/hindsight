/**
 * prompt-blocks.ts — an agent's instructions cut into the blocks they are
 * built from, at the openers the prompt builders print, so a run's page can
 * show where each part came from:
 *
 *   - the analyst's brief: "## Analyst: <name>", then its strategy, its
 *     Rules and its Setups (lib/agent/analyst-brief.ts);
 *   - the house rules: HOUSE_RULES itself (lib/agent/house-rules.ts);
 *   - the Market and portfolio block, one block per "### " part under its
 *     "## Market and portfolio" heading (lib/agent/market-and-portfolio.ts);
 *   - on a trigger run, the stock's row under its "$T, its row (get_theses)"
 *     banner (lib/agent/system-prompts/intraday-tactical.ts), and inside the
 *     row's `said`: the notes on the stock, then its Activity lines from
 *     "WHAT'S BEEN SAID ON $T" (lib/agent/shared-notes.ts, stock-context.ts).
 *
 * Everything else is the agent's own instructions, one block, marked where
 * each other block sat. A prompt with none of the openers is one block.
 * prompt-blocks.test.ts holds every opener to what the builders print.
 * Pure.
 */
import { HOUSE_RULES } from "@/lib/agent/house-rules";

export interface PromptBlock {
  label: string;
  text: string;
  /** Characters of the prompt it covers, as sent. */
  chars: number;
}

/** A span of the prompt one block covers. `text` replaces the span's own text when shown (a row with its notes and Activity cut out). */
interface Claim {
  start: number;
  end: number;
  label: string;
  text?: string;
  chars?: number;
  /** The claim this one is part of (a row's notes and Activity): kept only with it. */
  of?: Claim;
}

const ANALYST = "## Analyst: ";
const MARKET = "## Market and portfolio";
const SAID = "WHAT'S BEEN SAID ON $";
const ROW_BANNER = /(?:^|\n)(═{10,}\n\$([A-Z0-9.\-]+), its row \(get_theses\)\n═{10,}\n)/;

/** Where a line starting with `prefix` begins, from `from`; -1 when none. */
function lineAt(text: string, prefix: string, from = 0): number {
  let i = text.indexOf(prefix, from);
  while (i > 0 && text[i - 1] !== "\n") i = text.indexOf(prefix, i + 1);
  return i;
}

/** The end of the paragraph starting at `i`: the next blank line, or the end. */
function paragraphEnd(text: string, i: number): number {
  const j = text.indexOf("\n\n", i);
  return j < 0 ? text.length : j;
}

/** `end` moved back past the blank lines and spaces before it, so a block ends on its own last line. */
function trimmed(text: string, start: number, end: number): number {
  while (end > start && /\s/.test(text[end - 1])) end--;
  return end;
}

/** The next line, after `from`, that opens a new section: a "## " heading or a ═══ banner. */
function nextSection(text: string, from: number, except: readonly string[] = []): number {
  const re = /\n(## [^\n]*|═{10,})/g;
  re.lastIndex = from;
  for (let m = re.exec(text); m; m = re.exec(text)) if (!except.includes(m[1])) return m.index;
  return text.length;
}

function analystBrief(text: string): Claim[] {
  const start = lineAt(text, ANALYST);
  if (start < 0) return [];
  // Its Rules paragraph, before the next "## " heading: a brief without one claims nothing, rather than the prompt up to another section's "Rules:".
  const rules = text.indexOf("\n\nRules:\n", start);
  const nextHeading = lineAt(text, "## ", start + ANALYST.length);
  if (rules < 0 || (nextHeading >= 0 && rules > nextHeading)) return [];
  let end = paragraphEnd(text, rules + 2);
  if (text.startsWith("\n\nSetups:\n", end)) end = paragraphEnd(text, end + 2);
  return [{ start, end, label: text.slice(start + 3, text.indexOf("\n", start)).trim() }];
}

function houseRules(text: string): Claim[] {
  const exact = text.indexOf(HOUSE_RULES);
  if (exact >= 0) return [{ start: exact, end: exact + HOUSE_RULES.length, label: "House rules" }];
  // An older record: from the rules' first line to the next section after their own headings.
  const start = lineAt(text, HOUSE_RULES.split("\n")[0]);
  if (start < 0) return [];
  const own = HOUSE_RULES.split("\n").filter((l) => l.startsWith("## "));
  return [{ start, end: trimmed(text, start, nextSection(text, start, own)), label: "House rules" }];
}

function marketBlock(text: string): Claim[] {
  const start = lineAt(text, MARKET);
  if (start < 0) return [];
  const end = nextSection(text, start + MARKET.length);
  const parts: number[] = [];
  for (let i = lineAt(text, "### ", start); i >= 0 && i < end; i = lineAt(text, "### ", i + 4)) parts.push(i);
  if (parts.length === 0) return [{ start, end: trimmed(text, start, end), label: "Market and portfolio" }];
  // The block's own heading goes with its first part.
  return parts.map((p, k) => ({
    start: k === 0 ? start : p,
    end: trimmed(text, p, k + 1 < parts.length ? parts[k + 1] : end),
    label: text.slice(p + 4, text.indexOf("\n", p) < 0 ? end : text.indexOf("\n", p)).trim(),
  }));
}

function stockRow(text: string): Claim[] {
  const m = ROW_BANNER.exec(text);
  if (!m) return [];
  const T = m[2];
  const start = m.index + (m[0].startsWith("\n") ? 1 : 0);
  const body = start + m[1].length;
  if (text[body] !== "{") return [{ start, end: paragraphEnd(text, body), label: `$${T} row` }];
  // The row is printed with JSON.stringify(row, null, 2): it closes on a line of its own.
  const close = text.indexOf("\n}", body);
  if (close < 0) return [{ start, end: paragraphEnd(text, body), label: `$${T} row` }];
  const end = close + 2;
  let said: unknown;
  try {
    const row = JSON.parse(text.slice(body, end)) as Record<string, unknown>;
    said = row.said ?? row.context;
  } catch {
    return [{ start, end, label: `$${T} row` }];
  }
  if (typeof said !== "string" || !said.trim()) return [{ start, end, label: `$${T} row` }];
  const sent = JSON.stringify(said);
  const own = text.slice(start, end);
  const at = own.indexOf(sent);
  if (at < 0) return [{ start, end, label: `$${T} row` }];
  const cut = said.indexOf(SAID);
  const head = cut < 0 ? said : said.slice(0, cut);
  const tail = cut < 0 ? "" : said.slice(cut);
  const notes = head.trim();
  const activity = tail.trim();
  const shown = [notes ? `Notes on $${T}` : null, activity ? `Activity on $${T}` : null].filter(Boolean).join(" and ");
  // The row as sent, its `said` shown by name; its notes and Activity lines are blocks of their own.
  const row: Claim = { start, end, label: `$${T} row`, text: `${own.slice(0, at)}${JSON.stringify(`[See the ${shown} chips]`)}${own.slice(at + sent.length)}`, chars: own.length - sent.length };
  // Their sizes as sent: each one's part of the row's JSON string, escapes and a quote each, so together they are the whole string.
  const escaped = (s: string) => JSON.stringify(s).length - 2;
  const both = notes && activity;
  // Inside the row: no span of the prompt of their own, so they take none.
  const inside: Claim[] = [];
  if (notes) inside.push({ start: end, end: end, label: `Notes on $${T}`, text: notes, chars: both ? escaped(head) + 1 : sent.length, of: row });
  if (activity) inside.push({ start: end, end: end, label: `Activity on $${T}`, text: activity, chars: both ? escaped(tail) + 1 : sent.length, of: row });
  return [row, ...inside];
}

/** The blocks of one prompt: the agent's instructions first, then each other block in the order the prompt has them. */
export function promptBlocks(text: string): PromptBlock[] {
  const found = [...analystBrief(text), ...houseRules(text), ...marketBlock(text), ...stockRow(text)].sort((a, b) => a.start - b.start || a.end - b.end);
  // Two openers in one span (the brief's strategy quoting a heading): the first one keeps it. A part of a claim goes with it.
  const claims: Claim[] = [];
  for (const c of found) {
    const last = claims[claims.length - 1];
    if (c.of ? !claims.includes(c.of) : last && c.start < last.end) continue;
    claims.push(c);
  }
  if (claims.length === 0) return [{ label: "Instructions", text, chars: text.length }];
  const pieces: string[] = [];
  let chars = 0;
  let at = 0;
  for (const c of claims) {
    if (c.end === c.start) continue;
    const gap = text.slice(at, c.start);
    if (gap.trim()) pieces.push(gap.trim());
    chars += gap.length;
    pieces.push(`[See the "${c.label}" chip]`);
    at = c.end;
  }
  const tail = text.slice(at);
  if (tail.trim()) pieces.push(tail.trim());
  chars += tail.length;
  return [
    { label: "Instructions", text: pieces.join("\n\n"), chars },
    ...claims.map((c) => ({ label: c.label, text: c.text ?? text.slice(c.start, c.end), chars: c.chars ?? c.end - c.start })),
  ];
}
