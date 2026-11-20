/**
 * What /how-it-works/framework shows, built on the server from the code this
 * deploy runs. Every agent is read from its record (lib/agent/engine/agents),
 * the same way for each: its instructions (its own text and the shared texts,
 * in the record's order), its context (the date line and each read), its
 * message, each with its title and line (lib/agent/engine/parts.ts), and each part sized from
 * the latest request the account's runs saved for that agent: the manifest
 * the run kept with it (lib/agent/run-requests.ts), the same numbers the
 * run's Context panel shows. An agent with no saved run yet is sized on its
 * sample day (./agent-samples.ts), and the page says which. Its tools are the
 * record's. The situation texts are the skill files themselves.
 *
 * The records and samples are built once per server instance (a deploy that
 * changes a record changes the page); the runs are read on each request. A
 * sample that can't be built leaves that agent unsized and says so, rather
 * than the page failing.
 */

import { whenItRuns } from "@/lib/agent/engine/schedule";
import { providerToolNames } from "@/lib/agent/engine/types";
import { zodSchema } from "ai";
import { swatchOf } from "@/components/docs/framework/swatch";
import { AGENTS } from "@/lib/agent/engine/agents";
import { CONTEXT, DATE_LINE } from "@/lib/agent/engine/parts";
import { importsOf, instructionSections } from "@/lib/agent/engine/instructions";
import { isFile, type AgentRecord, type BuiltNewest, type BuiltRequest, type ContextId, type PartKind, type SentPartManifest, type Where } from "@/lib/agent/engine/types";
import { getAccountId } from "@/lib/auth/account";
import { REQUEST_ROLE, byParts, viewOfRecord, type RequestRecord } from "@/lib/agent/run-requests";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";
import { situationText } from "@/lib/agent/situation-skills";
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

/** A part an agent's record lists: where it goes, which of the agent's three parts it is, and its line. */
interface Listed {
  id: string;
  title: string;
  kind: PartKind;
  where: Where;
  section: FrameworkPart["section"];
  about: string;
  source: string;
  /** Sent only on some runs (the stock's situations). */
  someRuns?: boolean;
}

/**
 * The parts a record lists, as the run's Context panel lists them: its
 * instruction file (what it imports inside it); then its context, the facts
 * sent with its instructions first; then its first message in order (or
 * what rides on each message you send).
 */
export function recordParts(r: AgentRecord): Listed[] {
  const first: Where = r.conversation ? "newest" : "message";
  return [
    // Its instructions: one file, its imports inside it; its line is how its own words open.
    ...r.instructions.filter(isFile).map((e): Listed => {
      const own = instructionSections(e).filter((s) => s.label === e).map((s) => s.text).join("");
      const imports = importsOf(e);
      return { id: e, title: `Its instructions (${e})`, kind: "own", where: "instructions", section: "instructions", about: openingOf(own), source: `lib/agent/engine/agents/${e}${imports.length ? `, importing ${imports.join(", ")}` : ""}` };
    }),
    // The facts its record sends with the instructions, where they were measured: context all the same.
    ...r.instructions
      .filter((e): e is ContextId => !isFile(e))
      .map((e): Listed => ({ id: e, title: CONTEXT[e].title, kind: "context", where: "instructions", section: "context", about: CONTEXT[e].about, source: CONTEXT[e].source, ...(e === "situations" ? { someRuns: true } : {}) })),
    { id: "line", ...DATE_LINE, kind: "line", where: first, section: "context" },
    // Each read and the message, where the record lists it.
    ...r.context.map((id): Listed =>
      id === "message"
        ? { id: "message", title: "The message", kind: "message", where: "message", section: "message", about: r.messageFrom, source: r.messageFrom }
        : { id, title: CONTEXT[id].title, kind: "context", where: first, section: "context", about: CONTEXT[id].about, source: CONTEXT[id].source },
    ),
  ];
}

/** One agent, read from its record: its parts in order, each sized on its sample, and its tools. */
export function frameworkAgent(record: AgentRecord, tools: Record<string, ToolDef> = allTools()): FrameworkAgent {
  const sample = sampleOf(record);
  const listedParts = recordParts(record);
  // The sample must be this record's: every part it sent is one the record lists, in the same place.
  const listed = new Set(listedParts.map((p) => keyOf(p.where, p.id)));
  const foreign = sample?.sent.find((s) => !listed.has(keyOf(s.manifest.where, s.manifest.id)));
  if (foreign) console.warn(`[framework] ${record.id}'s sample sent a part its record doesn't list: ${foreign.manifest.where} ${foreign.manifest.id}`);
  const sent = new Map((foreign ? [] : (sample?.sent ?? [])).map((s) => [keyOf(s.manifest.where, s.manifest.id), s]));

  const parts: FrameworkPart[] = listedParts.map(({ someRuns, ...p }) => ({
    ...p,
    ...(someRuns ? { someRuns } : {}),
    chars: sent.get(keyOf(p.where, p.id))?.manifest.chars ?? null,
    swatch: swatchOf(p),
  }));

  const all = [...record.tools, ...(record.afterSave ?? [])];
  const measured = all.filter((n) => tools[n]);
  return {
    id: record.id,
    name: record.name,
    does: record.does,
    runsWhen: whenItRuns(record),
    messageFrom: record.messageFrom,
    model: record.model,
    maxSteps: record.maxSteps,
    output: record.output,
    sizedOn: sample && !foreign ? { kind: "sample", from: sample.from } : null,
    parts,
    tools: {
      names: all,
      chars: measured.length ? measured.reduce((n, name) => n + toolChars(tools[name]), 0) : null,
      unmeasured: all.filter((n) => !tools[n]),
      provider: providerToolNames(record),
    },
  };
}

function measure(): FrameworkData {
  const tools = allTools();
  const situations = (Object.keys(SITUATIONS) as SituationCode[]).map((code) => ({
    code,
    name: SITUATIONS[code].name,
    chars: situationText(code, null).length,
    // The opening of the text, for the page to quote.
    opening: situationText(code, null).replace(/`/g, "").split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 220),
    origin: SITUATION_ORIGIN[code],
  }));
  return { agents: AGENTS.map((r) => frameworkAgent(r, tools)), situations, read: buildFrameworkRead() };
}

let cached: FrameworkData | null = null;

/** Every agent read from its record and sized on its sample day; built once per server instance. */
export function buildFrameworkData(): FrameworkData {
  cached ??= measure();
  return cached;
}

/** What a run kept that sizes an agent: when, which run, its parts as named, and its tool menu as the Context panel counts it. */
export interface RunSizes {
  at: string;
  runId: string;
  parts: SentPartManifest[];
  toolChars: number | null;
}

/** The sizes in one saved request record, as its run's Context panel reads them. */
export function runSizesOf(record: RequestRecord, at: Date, runId: string): RunSizes {
  const menu = viewOfRecord(record).categories.find((c) => c.part === "tools");
  return { at: at.toISOString(), runId, parts: record.parts ?? [], toolChars: menu?.chars ?? null };
}

/** An agent sized on a run: each part the run's manifest names, the tool menu as that run sent it. */
export function sizedOnRun(agent: FrameworkAgent, run: RunSizes): FrameworkAgent {
  const sent = new Map(run.parts.filter((p) => p.chars > 0).map((p) => [keyOf(p.where, p.id), p.chars]));
  const listed = new Set(agent.parts.map((p) => keyOf(p.where, p.id)));
  return {
    ...agent,
    sizedOn: { kind: "run", at: run.at, runId: run.runId, gone: run.parts.filter((p) => p.chars > 0 && !listed.has(keyOf(p.where, p.id))).map((p) => p.title) },
    parts: agent.parts.map((p) => ({ ...p, chars: sent.get(keyOf(p.where, p.id)) ?? null })),
    tools: { ...agent.tools, chars: run.toolChars, unmeasured: [] },
  };
}

/**
 * Each agent's latest request the account's runs saved with its agent named
 * (RequestRecord.agent, written right after `call`, so only each row's first
 * characters are read to find it); then just those rows are loaded.
 */
async function latestRuns(accountId: string): Promise<Map<string, RunSizes>> {
  const latest = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT DISTINCT ON (agent) id FROM (
      SELECT m.id, m."createdAt", substring(left(m.content, 200) from '"agent":"([a-z_]+)"') AS agent
      FROM "RunMessage" m JOIN "ResearchRun" r ON r.id = m."runId"
      WHERE m.role = ${REQUEST_ROLE} AND r."accountId" = ${accountId}
    ) x
    WHERE agent IS NOT NULL
    ORDER BY agent, "createdAt" DESC`;
  if (!latest.length) return new Map();
  const rows = await prisma.runMessage.findMany({ where: { id: { in: latest.map((r) => r.id) } }, select: { content: true, createdAt: true, runId: true } });
  const out = new Map<string, RunSizes>();
  for (const row of rows) {
    try {
      const record = JSON.parse(row.content) as RequestRecord;
      // A record kept before the three parts names its parts the old way (kind "block"): the agent stays on its sample until it runs again.
      if (record.agent && record.parts?.length && !record.parts.some((p) => (p.kind as string) === "block")) out.set(record.agent, runSizesOf(record, row.createdAt, row.runId));
    } catch {
      // A record that doesn't read leaves its agent on its sample.
    }
  }
  return out;
}

/**
 * The page's data for the signed-in account: every agent sized on its latest
 * saved run where there is one, else on its sample day. A read that fails
 * leaves every agent on its sample, and says so in the server log.
 */
export async function loadFrameworkData(): Promise<FrameworkData> {
  const base = buildFrameworkData();
  // The sign-in is read outside the catch: reading the session's cookies is how Next knows the page is rendered per request.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const accountId = user ? await getAccountId(user.id) : null;
  if (!accountId) return base;
  try {
    const runs = await latestRuns(accountId);
    return { ...base, agents: base.agents.map((a) => (runs.has(a.id) ? sizedOnRun(a, runs.get(a.id)!) : a)) };
  } catch (err) {
    console.warn(`[framework] the agents' latest runs couldn't be read: ${err instanceof Error ? err.message : err}`);
    return base;
  }
}
