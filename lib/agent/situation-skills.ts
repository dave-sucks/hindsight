/**
 * A situation's text, read from its skill file (lib/agent/engine/skills/*.md)
 * on the server. A skill has a paragraph for a stock we hold and one for a
 * stock we watch; a run is sent the one that fits its stock, whole and as
 * written. next.config.ts traces the folder into every function.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { SITUATIONS, type SituationCode } from "@/lib/agent/situations";

export const SKILLS_DIR = path.join(process.cwd(), "lib", "agent", "engine", "skills");

const HOLD = "A stock we hold.";
const WATCH = "A stock we watch.";

const read = new Map<string, string>();

/** One skill file as written, without its last newline. */
export function skillSource(file: string): string {
  let text = read.get(file);
  if (text == null) {
    text = readFileSync(path.join(SKILLS_DIR, file), "utf8").replace(/\n$/, "");
    read.set(file, text);
  }
  return text;
}

/**
 * A situation's text: its skill file without the paragraph for the other kind
 * of stock, or the whole file when `held` is null (both kinds are on the list,
 * or a person is reading it). Promoted and a note to answer are their text in
 * the table.
 */
export function situationText(code: SituationCode, held: boolean | null): string {
  const s = SITUATIONS[code];
  if (!s.skill) return s.guidance ?? "";
  const source = skillSource(s.skill);
  if (held == null) return source;
  const other = held ? WATCH : HOLD;
  return source.split("\n\n").filter((p) => !p.startsWith(other)).join("\n\n");
}

/** The texts these stocks' situations call for, each code once, in rank order: the part for a stock we hold, the part for one we watch, or both when the list has both. */
export function guidanceFor(stocks: Iterable<{ code: SituationCode; held: boolean }>): Partial<Record<SituationCode, string>> {
  const wanted = new Map<SituationCode, Set<boolean>>();
  for (const { code, held } of stocks) wanted.set(code, (wanted.get(code) ?? new Set()).add(held));
  const out: Partial<Record<SituationCode, string>> = {};
  for (const code of Object.keys(SITUATIONS) as SituationCode[]) {
    const kinds = wanted.get(code);
    if (kinds) out[code] = situationText(code, kinds.size === 1 ? [...kinds][0] : null);
  }
  return out;
}

/** Every skill by its situation's name, for the knowledge library. */
export function skillIndex(): Array<{ id: SituationCode; name: string }> {
  return (Object.keys(SITUATIONS) as SituationCode[]).filter((c) => SITUATIONS[c].skill).map((id) => ({ id, name: SITUATIONS[id].name }));
}
