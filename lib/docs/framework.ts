/**
 * What /how-it-works/framework shows, built on the server from the code this
 * deploy runs. Every agent is read from its record (lib/agent/engine/agents),
 * the same way for each: its parts in the record's order, a block's title and
 * line from the library (lib/agent/engine/blocks.ts), and each part sized from
 * the request the engine built on the agent's sample day
 * (./agent-samples.ts): the manifest that request names its parts with. Its
 * tools are the record's, measured the way they are sent (each tool's
 * description and its JSON schema). The situation texts are the SITUATIONS
 * table itself.
 *
 * Built once per server instance; a deploy that changes a record changes the
 * page. A sample that can't be built leaves that agent's parts unsized and
 * says so, rather than the page failing.
 */

import { zodSchema } from "ai";
import { swatchOf } from "@/components/docs/framework/swatch";
import { AGENTS } from "@/lib/agent/engine/agents";
import { BLOCKS } from "@/lib/agent/engine/blocks";
import { isOwn, type AgentRecord, type BuiltNewest, type BuiltRequest, type RecordPart, type SentPartManifest, type Where } from "@/lib/agent/engine/types";
import { byParts } from "@/lib/agent/run-requests";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";
import { createResearchTools } from "@/lib/agent/tools";
import { AGENT_SAMPLES } from "./agent-samples";
import type { FrameworkAgent, FrameworkData, FrameworkPart } from "./framework-content";
import { SITUATION_ORIGIN, buildFrameworkRead } from "./read-grid";

type ToolDef = { description?: string; inputSchema: unknown };

/** Every tool an agent can be given, as the tool set builds it. */
const allTools = () => createResearchTools({ runId: "docs", userId: "u", accountId: "a", analystId: "an", runMode: "DOCS", runEnvironment: "PAPER" } as never) as unknown as Record<string, ToolDef>;

/** A tool as it is sent: its description and its JSON schema, in characters. */
const toolChars = (t: ToolDef) => (t.description ?? "").length + JSON.stringify(zodSchema(t.inputSchema as never).jsonSchema).length;

/** A line that ends a paragraph and is no part of one: blank, a rule, or a # heading. */
const isBreak = (line: string) => !/[A-Za-z]/.test(line) || /^\s*#/.test(line);
/** A heading set in capitals ("HOW YOU WORK"), with none of its own words after it. */
const isCapsHeading = (para: string) => (para.match(/[A-Z]/g) ?? []).length > 0.6 * (para.match(/[A-Za-z]/g) ?? []).length;
/** A paragraph led by capitals and a dash ("YOUR JOB — one research note"): the words after the dash. */
const CAPS_LEAD = /^[A-Z][A-Z'&/-]+(?: [A-Z][A-Z'&/-]+)* [—–] (.+)$/;
/** A line that is a list item: a bullet or a number. */
const LIST_ITEM = /^\s*(?:[•*-]|\d+\.)\s+/;

/**
 * How a text opens, in a sentence: its first paragraph of words (its hard
 * wraps joined, its markup dropped), past any heading, to the end of its
 * first sentence.
 */
export function openingOf(text: string, title = ""): string {
  const paras: string[] = [];
  let cur: string[] = [];
  const end = () => {
    if (cur.length) paras.push(cur.join(" "));
    cur = [];
  };
  for (const line of text.split("\n")) {
    if (isBreak(line)) {
      end();
      continue;
    }
    // A list item starts a paragraph of its own.
    if (LIST_ITEM.test(line)) end();
    cur.push(line.replace(/\*\*|`/g, "").replace(LIST_ITEM, "").replace(/^[\s>[]+/, "").trim());
  }
  end();
  const said = paras.map((p) => {
    const lead = p.match(CAPS_LEAD)?.[1];
    return lead ? lead.replace(/^./, (c) => c.toUpperCase()) : p;
  });
  const same = (p: string) => p.replace(/[^a-z]/gi, "").toLowerCase() === title.replace(/[^a-z]/gi, "").toLowerCase();
  const line = said.find((p, i) => !isCapsHeading(paras[i]) && !same(p)) ?? said[0];
  if (!line) return "";
  // A first sentence of a word or two ("Product.") reads on into the next.
  let sentence = "";
  for (const s of line.split(/(?<=[.!?])\s+/)) {
    sentence = sentence ? `${sentence} ${s}` : s;
    if (sentence.length >= 30) break;
  }
  return sentence.length > 200 ? `${sentence.slice(0, 199).trimEnd()}…` : sentence;
}

interface Sent {
  manifest: SentPartManifest;
  text: string;
}

/** The sample's parts with their texts, in order; null when the record has no sample or it couldn't be built. */
function sampleOf(record: AgentRecord): { sent: Sent[]; from: string } | null {
  const sample = AGENT_SAMPLES[record.id];
  if (!sample) return null;
  let built: { request: BuiltRequest; newest?: BuiltNewest };
  try {
    built = sample.build(record);
  } catch (err) {
    console.warn(`[framework] ${record.id}'s sample couldn't be built: ${err instanceof Error ? err.message : err}`);
    return null;
  }
  const { request, newest } = built;
  const on = (where: Where) => request.parts.filter((p) => p.where === where);
  // Each sent part's text, cut from what was sent the way the run's Context panel cuts it.
  const pair = (parts: SentPartManifest[], text: string) => {
    const cut = parts.length ? byParts(parts, text) : { parts: [], after: "" };
    if (!cut || cut.after) throw new Error("its parts don't add up to what it sent");
    const sent = parts.filter((p) => p.chars > 0);
    return cut.parts.map((c, i) => ({ manifest: sent[i], text: c.sections[0].text }));
  };
  try {
    return {
      from: sample.from,
      sent: [...pair(on("instructions"), request.instructions), ...pair(on("message"), request.message), ...(newest ? pair(newest.parts, newest.texts.join("\n\n")) : [])],
    };
  } catch (err) {
    console.warn(`[framework] ${record.id}'s sample: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

const keyOf = (where: Where, id: string) => `${where}:${id}`;
const recordParts = (r: AgentRecord): Array<{ part: RecordPart; where: Where }> => [
  ...r.instructions.map((part) => ({ part, where: "instructions" as const })),
  ...r.message.map((part) => ({ part, where: "message" as const })),
  ...(r.newest ?? []).map((part) => ({ part, where: "newest" as const })),
];

/** One agent, read from its record: its parts in order, each sized on its sample, and its tools. */
export function frameworkAgent(record: AgentRecord, tools: Record<string, ToolDef> = allTools()): FrameworkAgent {
  const sample = sampleOf(record);
  // The sample must be this record's: every part it sent is one the record lists, in the same place.
  const listed = new Set(recordParts(record).map(({ part, where }) => keyOf(where, isOwn(part) ? part.own : part.block)));
  const foreign = sample?.sent.find((s) => !listed.has(keyOf(s.manifest.where, s.manifest.id)));
  if (foreign) console.warn(`[framework] ${record.id}'s sample sent a part its record doesn't list: ${foreign.manifest.where} ${foreign.manifest.id}`);
  const sent = new Map((foreign ? [] : (sample?.sent ?? [])).map((s) => [keyOf(s.manifest.where, s.manifest.id), s]));

  const parts: FrameworkPart[] = recordParts(record).map(({ part, where }) => {
    if (isOwn(part)) {
      const s = sent.get(keyOf(where, part.own));
      const fixed = typeof part.text === "string" ? (part.text as string) : null;
      const text = s?.text || fixed || "";
      return {
        id: part.own,
        title: part.title,
        kind: "own",
        where,
        about: openingOf(text, part.title),
        source: `lib/agent/engine/agents (${record.id})`,
        ...(fixed == null ? { perRun: true } : {}),
        chars: s?.manifest.chars ?? null,
        swatch: "job",
      };
    }
    const def = BLOCKS[part.block];
    const s = sent.get(keyOf(where, part.block));
    return { id: def.id, title: def.title, kind: "block", where, about: def.about, source: def.source, chars: s?.manifest.chars ?? null, swatch: swatchOf(def) };
  });

  const measured = record.tools.filter((n) => tools[n]);
  return {
    id: record.id,
    name: record.name,
    does: record.does,
    runsWhen: record.runsWhen,
    model: record.model,
    maxSteps: record.maxSteps,
    output: record.output,
    sample: sample && !foreign ? sample.from : null,
    parts,
    tools: {
      names: [...record.tools],
      chars: measured.length ? measured.reduce((n, name) => n + toolChars(tools[name]), 0) : null,
      unmeasured: record.tools.filter((n) => !tools[n]),
      provider: [...(record.providerTools ?? [])],
    },
  };
}

function measure(): FrameworkData {
  const tools = allTools();
  const situations = (Object.keys(SITUATIONS) as SituationCode[]).map((code) => ({
    code,
    name: SITUATIONS[code].name,
    chars: SITUATIONS[code].guidance.length,
    // The opening of the text, for the page to quote.
    opening: SITUATIONS[code].guidance.replace(/`/g, "").split(/(?<=[.!?])\s+/)[0]?.slice(0, 220) ?? "",
    origin: SITUATION_ORIGIN[code],
  }));
  return { agents: AGENTS.map((r) => frameworkAgent(r, tools)), situations, read: buildFrameworkRead() };
}

let cached: FrameworkData | null = null;

export function buildFrameworkData(): FrameworkData {
  cached ??= measure();
  return cached;
}
