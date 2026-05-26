/**
 * Workflow doc content loader.
 *
 * Each agent has a markdown file at app/(root)/agent-workflow/content/<id>.md
 * with YAML-ish frontmatter and a markdown body. This module reads + parses
 * those files at module load time (Next.js bundles them once per server
 * process — fine for static doc content that only changes at deploy time).
 *
 * Why a tiny inline frontmatter parser instead of `gray-matter`: we only
 * need string and string[] values; the format is `key: value` with
 * `key: [a, b, c]` for arrays. Adding a YAML dep for this is overkill.
 *
 * Files have shape:
 *
 *   ---
 *   id: discovery
 *   title: Discovery Run
 *   summary: ...one-line excerpt for the index card...
 *   ---
 *
 *   ## Step 1 · Scan
 *
 *   ...markdown body with [agent:id], [tool:name], [entity:name] links...
 *
 * Returns null when the file doesn't exist — callers fall back to the
 * legacy hand-typed string fields on the registry entry, so the migration
 * can be incremental.
 */

import fs from "node:fs";
import path from "node:path";

export interface WorkflowFrontmatter {
  id: string;
  title?: string;
  summary?: string;
}

export interface WorkflowContent {
  frontmatter: WorkflowFrontmatter;
  body: string;
}

// Path is relative to the repo root. Next.js bundlers serve from the repo
// root at runtime when calling fs.readFileSync, so `process.cwd()`
// resolves correctly under both `next dev` and `next start`.
const CONTENT_DIR = path.join(
  process.cwd(),
  "app",
  "(root)",
  "agent-workflow",
  "content",
);

// In-memory cache: each file is read once per server process. Doc content
// only changes at deploy time, so a cold-cache miss followed by sticky
// reads is the right tradeoff.
const CACHE = new Map<string, WorkflowContent | null>();

export function getWorkflowContent(id: string): WorkflowContent | null {
  if (CACHE.has(id)) return CACHE.get(id) ?? null;

  const filePath = path.join(CONTENT_DIR, `${id}.md`);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    CACHE.set(id, null);
    return null;
  }

  const content = parseMarkdownDoc(raw, id);
  CACHE.set(id, content);
  return content;
}

// ── Tiny frontmatter parser ─────────────────────────────────────────────────
// Handles the subset we need: `key: value` lines + `key: [a, b, c]` arrays.
// Multi-line values, nested objects, anchors — not supported (and not
// needed for workflow docs).

function parseMarkdownDoc(raw: string, fallbackId: string): WorkflowContent {
  const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = raw.match(FRONTMATTER_RE);

  let frontmatter: WorkflowFrontmatter = { id: fallbackId };
  let body = raw;

  if (match) {
    const fmText = match[1];
    body = raw.slice(match[0].length);
    frontmatter = { ...frontmatter, ...parseFrontmatterBlock(fmText) };
  }

  // Force id to fall back to filename if the doc omits it. Keeps
  // misnamed-doc errors from going unnoticed.
  if (!frontmatter.id) frontmatter.id = fallbackId;

  return { frontmatter, body: body.trim() };
}

function parseFrontmatterBlock(text: string): Partial<WorkflowFrontmatter> {
  const out: Record<string, string> = {};
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const valueRaw = trimmed.slice(colonIdx + 1).trim();
    // Strip surrounding quotes if present (single or double).
    const value =
      (valueRaw.startsWith('"') && valueRaw.endsWith('"')) ||
      (valueRaw.startsWith("'") && valueRaw.endsWith("'"))
        ? valueRaw.slice(1, -1)
        : valueRaw;
    out[key] = value;
  }
  return out as Partial<WorkflowFrontmatter>;
}
