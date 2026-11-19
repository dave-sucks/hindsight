/**
 * The instruction files, read from lib/agent/engine/agents/*.md on the
 * server. Each agent's instructions are one markdown file next to its
 * record. A file may import another, as CLAUDE.md does: a line that is
 * "@rules.md" and nothing else is that file's text. Every agent that writes
 * for you imports the rules (the house rules and how you write); the
 * Writer and the Holding refresh import the research rules too. next.config.ts traces the folder into every function, so a deploy
 * carries the files it sends.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const INSTRUCTIONS_DIR = path.join(process.cwd(), "lib", "agent", "engine", "agents");

/** A line that imports another instruction file: "@<file>.md" alone on its line. */
const IMPORT = /^@([\w-]+\.md)$/gm;

const read = new Map<string, string>();

/** One file as written, without its last newline: its imports are still lines. */
export function instructionSource(file: string): string {
  let text = read.get(file);
  if (text == null) {
    text = readFileSync(path.join(INSTRUCTIONS_DIR, file), "utf8").replace(/\n$/, "");
    read.set(file, text);
  }
  return text;
}

/** The files a file imports, in order. */
export function importsOf(file: string): string[] {
  return [...instructionSource(file).matchAll(IMPORT)].map((m) => m[1]);
}

/** One instruction file's text as it is sent: each import line is the imported file's text. */
export function instructionText(file: string, seen: readonly string[] = []): string {
  if (seen.includes(file)) throw new Error(`${[...seen, file].join(" imports ")}: an instruction file can't import itself`);
  return instructionSource(file).replace(IMPORT, (_line, imported: string) => instructionText(imported, [...seen, file]));
}

/**
 * The file as it is sent, cut where each import starts and ends: its own
 * words labeled by the file, each import by "@<file>". Joined, they are
 * instructionText(file).
 */
export function instructionSections(file: string): Array<{ label: string; text: string }> {
  const out: Array<{ label: string; text: string }> = [];
  const source = instructionSource(file);
  let at = 0;
  for (const m of source.matchAll(IMPORT)) {
    if (m.index! > at) out.push({ label: file, text: source.slice(at, m.index) });
    out.push({ label: `@${m[1]}`, text: instructionText(m[1], [file]) });
    at = m.index! + m[0].length;
  }
  if (at < source.length) out.push({ label: file, text: source.slice(at) });
  return out;
}
