/**
 * Reading a guide doc (docs/guide/<slug>.md) into the parts the page draws.
 * Pure, so guide.test.ts reads every doc through the same code the page uses.
 * The conventions are written up in components/docs/markdown-doc.tsx.
 */

import type { TickerActionIcon } from "@/components/ai-elements/tool-progress";
import type { ChatRow, ChatStep } from "@/components/docs/chat-mock";

/** Every picture a doc can place with `<!-- asset: name -->`; components/docs/doc-assets.tsx draws each. */
export const GUIDE_ASSETS = [
  "card",
  "tools",
  "read-demo",
  "trigger-kinds",
  "thesis-lifecycle",
  "analyst-styles",
  "playbook",
  "system-layers",
  "request-grid",
  "situation-flow",
] as const;
export type GuideAsset = (typeof GUIDE_ASSETS)[number];

export type Block =
  | { kind: "md"; text: string }
  | { kind: "asset"; name: string; arg?: string }
  | { kind: "chat"; caption?: string; steps: ChatStep[] }
  | { kind: "facts"; facts: Array<[label: string, value: string]> };

export type Part =
  | { kind: "section"; title: string | null; blocks: Block[] }
  | { kind: "details"; title: string; body: string };

export interface ParsedDoc {
  title: string;
  lead: string;
  rest?: string;
  description?: string;
  parts: Part[];
}

const ASSET_LINE = /^<!--\s*asset:\s*([\w-]+)(?:\s+([\w-]+))?\s*-->$/;

/** Splits a guide doc into its header and its parts. Pure, so the test reads every doc through it. */
export function parseDoc(source: string): ParsedDoc {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  const skipBlank = () => {
    while (i < lines.length && lines[i].trim() === "") i++;
  };
  const paragraph = () => {
    const out: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") out.push(lines[i++]);
    return out.join(" ").trim();
  };

  skipBlank();
  const title = lines[i]?.startsWith("# ") ? lines[i++].slice(2).trim() : "";
  skipBlank();
  const first = paragraph();
  const m = first.match(/^\*\*(.+?)\*\*\s*(.*)$/);
  const lead = m ? m[1] : first;
  const rest = m && m[2] ? m[2] : undefined;
  skipBlank();
  let description: string | undefined;
  const next = lines[i] ?? "";
  if (next && !next.startsWith("#") && !next.startsWith("<") && !next.startsWith("```")) description = paragraph();

  const parts: Part[] = [];
  let section: Extract<Part, { kind: "section" }> = { kind: "section", title: null, blocks: [] };
  let buffer: string[] = [];
  const flushText = () => {
    const text = buffer.join("\n").trim();
    if (text) section.blocks.push({ kind: "md", text });
    buffer = [];
  };
  const closeSection = () => {
    flushText();
    if (section.title !== null || section.blocks.length) parts.push(section);
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith("## ")) {
      closeSection();
      section = { kind: "section", title: t.slice(3).trim(), blocks: [] };
      continue;
    }
    const asset = t.match(ASSET_LINE);
    if (asset) {
      flushText();
      section.blocks.push({ kind: "asset", name: asset[1], arg: asset[2] });
      continue;
    }
    if (t === "```facts") {
      flushText();
      const facts: Array<[string, string]> = [];
      for (i++; i < lines.length && lines[i].trim() !== "```"; i++) {
        const m = lines[i].trim().match(/^([^:]+):\s*(.*)$/);
        if (m) facts.push([m[1].trim(), m[2].trim()]);
      }
      section.blocks.push({ kind: "facts", facts });
      continue;
    }
    if (t === "```chat") {
      flushText();
      const body: string[] = [];
      for (i++; i < lines.length && lines[i].trim() !== "```"; i++) body.push(lines[i]);
      section.blocks.push(parseChat(body));
      continue;
    }
    if (t === "<details>") {
      closeSection();
      section = { kind: "section", title: null, blocks: [] };
      const body: string[] = [];
      let summary = "Details";
      for (i++; i < lines.length && lines[i].trim() !== "</details>"; i++) {
        const s = lines[i].trim().match(/^<summary>(.*)<\/summary>$/);
        if (s) summary = s[1];
        else body.push(lines[i]);
      }
      parts.push({ kind: "details", title: summary, body: body.join("\n").trim() });
      continue;
    }
    buffer.push(line);
  }
  closeSection();
  return { title, lead, rest, description, parts };
}

/**
 * A chat block, one line per step:
 *
 *   caption: Discovery for the PEAD Specialist.
 *   user: Find drift names off this week's reports.
 *   tools: Pulling reported earnings (+1 more)
 *   - 41 companies reported in the last 3 days            (a plain row)
 *   - CRWD [watch] {Proposal}: Writing the thesis          (a ticker row; the action and tag are optional)
 *   text: Three clear the rules. $CRWD (+6.8%) beat.
 */
export function parseChat(lines: readonly string[]): Extract<Block, { kind: "chat" }> {
  const steps: ChatStep[] = [];
  let caption: string | undefined;
  let rows: ChatRow[] | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const row = line.match(/^- (.*)$/);
    if (row && rows) {
      const tick = row[1].match(/^([A-Z]{1,5})(?: \[(\w+)\])?(?: \{([^}]+)\})?: (.*)$/);
      rows.push(tick ? { ticker: tick[1], action: tick[2] as TickerActionIcon | undefined, tag: tick[3], text: tick[4] } : { text: row[1] });
      continue;
    }
    const kv = line.match(/^(caption|user|tools|text): (.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === "caption") caption = value;
    else if (key === "user") steps.push({ kind: "user", text: value });
    else if (key === "text") steps.push({ kind: "text", text: value });
    else {
      rows = [];
      steps.push({ kind: "tools", label: value, rows });
    }
  }
  return { kind: "chat", caption, steps };
}

/** A section heading's anchor: "What's in it" → "whats-in-it". */
export function headingId(title: string): string {
  return title.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
