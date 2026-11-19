/**
 * The instruction files, read from lib/agent/engine/agents/*.md on the
 * server. Each agent's instructions are plain markdown next to its record;
 * the shared ones are the house rules, how you write and the research rules.
 * next.config.ts traces the folder into every function, so a deploy carries
 * the files it sends.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export const INSTRUCTIONS_DIR = path.join(process.cwd(), "lib", "agent", "engine", "agents");

const read = new Map<string, string>();

/** One instruction file's text, without its last newline. */
export function instructionText(file: string): string {
  let text = read.get(file);
  if (text == null) {
    text = readFileSync(path.join(INSTRUCTIONS_DIR, file), "utf8").replace(/\n$/, "");
    read.set(file, text);
  }
  return text;
}
