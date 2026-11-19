/**
 * The instruction files, read from lib/agent/engine/agents/*.md on the
 * server. Each agent's instructions are one markdown file next to its
 * record; every agent that writes for you also gets the two rules files, the
 * house rules and how you write. A file may import another, as CLAUDE.md
 * does: a line that is "@research-rules.md" and nothing else is that file's
 * text. next.config.ts traces the folder into every function, so a deploy
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
