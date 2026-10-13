/**
 * The guide's markdown, read from docs/guide/ on the server. The files are
 * the one source: agents read them in the repo, and /docs draws them through
 * components/docs/markdown-doc.tsx. next.config.ts traces the folder into the
 * /docs functions, so a deploy carries the files it draws.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const GUIDE_DIR = path.join(process.cwd(), "docs", "guide");

let cache: Readonly<Record<string, string>> | null = null;

/** Every doc in the guide by its file name without `.md`: `triggers`, `README`. */
export function loadGuide(): Readonly<Record<string, string>> {
  if (cache && process.env.NODE_ENV === "production") return cache;
  const out: Record<string, string> = {};
  for (const file of readdirSync(GUIDE_DIR)) {
    if (file.endsWith(".md")) out[file.slice(0, -3)] = readFileSync(path.join(GUIDE_DIR, file), "utf8");
  }
  cache = out;
  return out;
}
