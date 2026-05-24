/**
 * Read-side helpers for the V2 flat-schema narrative columns
 * (PR-9 — see docs/plans/THESIS_CLEANUP.md §1).
 *
 * Three sections (`snapshot`, `bullCase`, `bearCase`) replace the legacy
 * `reasoningSummary` / `thesisBullets` / `riskFlags` plain-shape fields.
 * Their stored JSONB shape is `{ text, citations }` for prose sections and
 * `{ bullets: [{ text, citation }] }` for bulleted sections. These helpers
 * extract a plain-string view so legacy consumers (run summaries, trade
 * evaluator post-mortems, briefings, render fallbacks) keep working
 * without having to crack the JSON shape themselves.
 *
 * Every helper tolerates `null`, `undefined`, the wrong-shape JSONB
 * (legacy / fabricated data), and arrays of bullets where individual
 * bullets are malformed. Returns the empty string or empty array on any
 * unparseable input — no throws.
 */

type Unknown = unknown;

function isObject(v: Unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** Extract the plain text from a `{ text, citations }` section. */
export function getSectionText(section: Unknown): string {
  if (!isObject(section)) return "";
  const text = section["text"];
  return typeof text === "string" ? text : "";
}

/** Extract the bullet text array from a `{ bullets: [{ text, citation }] }` section. */
export function getSectionBullets(section: Unknown): string[] {
  if (!isObject(section)) return [];
  const bullets = section["bullets"];
  if (!Array.isArray(bullets)) return [];
  const out: string[] = [];
  for (const b of bullets) {
    if (isObject(b) && typeof b["text"] === "string" && b["text"].length > 0) {
      out.push(b["text"]);
    }
  }
  return out;
}

/**
 * Convenience: returns the snapshot text (legacy `reasoningSummary` equivalent).
 */
export function getThesisSnapshotText(t: { snapshot?: Unknown }): string {
  return getSectionText(t.snapshot);
}

/**
 * Convenience: returns the bull case bullets as a plain string[] (legacy
 * `thesisBullets` equivalent).
 */
export function getThesisBullCaseBullets(t: { bullCase?: Unknown }): string[] {
  return getSectionBullets(t.bullCase);
}

/**
 * Convenience: returns the bear case bullets as a plain string[] (legacy
 * `riskFlags` equivalent).
 */
export function getThesisBearCaseBullets(t: { bearCase?: Unknown }): string[] {
  return getSectionBullets(t.bearCase);
}

/**
 * Pull the composite score (single conviction number, replacement for the
 * legacy `confidenceScore` int) from a Thesis row. Returns null when the
 * thesis hasn't been scored yet.
 */
export function getThesisComposite(t: { scoring?: Unknown }): number | null {
  if (!isObject(t.scoring)) return null;
  const c = t.scoring["composite"];
  return typeof c === "number" ? c : null;
}
