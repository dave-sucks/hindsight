/**
 * What the old builders sent on the engine fixtures, part by part
 * (./before-three-parts.golden.json, built at #1031's head before the three
 * parts): the proof that a part's words are the same, or changed only as the
 * plan says (../three-parts.engine.test.ts).
 */
import BEFORE from "./before-three-parts.golden.json";
import { byParts } from "@/lib/agent/run-requests";
import type { BuiltNewest, BuiltRequest, SentPartManifest } from "../types";

type Golden = { cases: Record<string, Record<string, number>>; texts: string[] };

/**
 * An agent's one document, cut back into the parts the old builders sent:
 * its own words ("own"), and each file it imports where it starts; the
 * rules are the house rules and how you write, the research rules theirs.
 */
function documentParts(p: SentPartManifest, text: string): Array<[string, string]> {
  if (!p.sections?.length) return [["own", text]];
  let at = 0;
  const cut = p.sections.map((s) => [s.label, text.slice(at, (at += s.chars))] as const);
  const own = cut.filter(([label]) => label === p.id).map(([, t]) => t).join("").replace(/^\n+|\n+$/g, "");
  const out: Array<[string, string]> = [["own", own]];
  for (const [label, t] of cut) {
    if (label === "@rules.md") {
      const at = t.indexOf("\n\n## How you write");
      out.push(["house_rules", t.slice(0, at)], ["how_you_write", t.slice(at + 2)]);
    } else if (label === "@research-rules.md") out.push(["research_rules", t]);
  }
  return out;
}

/** A case's old parts: "instructions:analyst_brief" → its text. */
export function before(caseKey: string): Record<string, string> {
  const g = BEFORE as Golden;
  const c = g.cases[caseKey];
  if (!c) throw new Error(`no old case ${caseKey}`);
  return Object.fromEntries(Object.entries(c).map(([k, i]) => [k, g.texts[i]]));
}

/** A built request's parts the same way: "instructions:own" → its text. Throws when they don't add up. */
export function partsOf(b: BuiltRequest, newest?: BuiltNewest): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (parts: BuiltRequest["parts"], text: string) => {
    if (!parts.length) return;
    const cut = byParts(parts, text);
    if (!cut || cut.after) throw new Error("its parts don't add up to what it sent");
    const sent = parts.filter((p) => p.chars > 0);
    // Keyed as the old builders named the parts: the agent's document cut back at its imports.
    cut.parts.forEach((c, i) => {
      const text = c.sections.map((s) => s.text).join("");
      if (sent[i].kind === "own") for (const [key, t] of documentParts(sent[i], text)) out[`${sent[i].where}:${key}`] = t;
      else out[`${sent[i].where}:${sent[i].id}`] = text;
    });
  };
  add(b.parts.filter((p) => p.where === "instructions"), b.instructions);
  add(b.parts.filter((p) => p.where === "message"), b.message);
  if (newest) add(newest.parts, newest.texts.join("\n\n"));
  return out;
}
