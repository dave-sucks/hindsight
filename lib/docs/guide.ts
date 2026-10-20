/**
 * The guide's markdown, read from docs/guide/ on the server. The files are
 * the one source: agents read them in the repo, and /docs draws them through
 * components/docs/markdown-doc.tsx. A doc's slug is its file name; the
 * folder (agents/, concepts/, reference/) is where it sits in the sidebar.
 * next.config.ts traces the folder into the /docs functions, so a deploy
 * carries the files it draws.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const GUIDE_DIR = path.join(process.cwd(), "docs", "guide");

/** Every guide file by slug: `triggers` → `concepts/triggers.md`, `README` → `README.md`. */
export function guideFiles(): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(GUIDE_DIR, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) walk(rel);
      else if (e.name.endsWith(".md")) out[e.name.slice(0, -3)] = rel;
    }
  };
  walk("");
  return out;
}

let cache: Readonly<Record<string, string>> | null = null;

/** Every doc in the guide by its slug: `triggers`, `README`. */
export function loadGuide(): Readonly<Record<string, string>> {
  if (cache && process.env.NODE_ENV === "production") return cache;
  const out: Record<string, string> = {};
  for (const [slug, rel] of Object.entries(guideFiles())) out[slug] = readFileSync(path.join(GUIDE_DIR, rel), "utf8");
  cache = out;
  return out;
}
