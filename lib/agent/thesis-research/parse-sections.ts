/**
 * parse-sections.ts — canonical 9-section parser for thesis research notes.
 *
 * Extracted verbatim from lib/agent/tools/write-thesis-research.ts
 * (THESIS_WRITER_V2) so the V2 writer pipeline can parse the research
 * model's text output server-side and persist it directly — the
 * FORWARD-VERBATIM relay through a second model is gone. The section
 * shapes here deliberately match record_thesis / update_thesis's
 * sectionTextSchema / sectionBulletSchema:
 *
 *   kind: "text"    → { text, citations }                  — prose paragraph
 *   kind: "bullets" → { bullets: [{ text, citation? }] }   — bulleted list
 *
 * Keep SECTION_HEADERS in sync with the note template in the writer's
 * research prompt (buildWriterResearchPrompt) — a renamed header here or
 * there silently drops the section.
 */

type SectionKind = "text" | "bullets";
export const SECTION_HEADERS: Array<{
  key: string;
  pattern: RegExp;
  kind: SectionKind;
}> = [
  { key: "snapshot", pattern: /^##\s+Snapshot\b/im, kind: "text" },
  { key: "recentCatalysts", pattern: /^##\s+Recent Catalysts\b/im, kind: "text" },
  { key: "fundamentals", pattern: /^##\s+Fundamentals\b/im, kind: "text" },
  { key: "latestEarnings", pattern: /^##\s+Latest Earnings\b/im, kind: "bullets" },
  { key: "catalystsAndEvents", pattern: /^##\s+Catalysts (?:&|and) Events\b/im, kind: "bullets" },
  { key: "bullCase", pattern: /^##\s+Bull Case\b/im, kind: "bullets" },
  { key: "bearCase", pattern: /^##\s+Bear Case\b/im, kind: "bullets" },
  { key: "analystConsensus", pattern: /^##\s+Analyst Consensus\b/im, kind: "text" },
  { key: "insiderTechnical", pattern: /^##\s+Insider (?:&|and) Technical\b/im, kind: "text" },
];

/**
 * Prose section — matches record_thesis `sectionTextSchema`.
 */
export interface ParsedTextSection {
  text: string;
  citations: string[];
}

/**
 * Single bulleted row with optional inline citation. `citation` is the
 * FIRST [STRUCTURED:...] or [WEB:...] marker found in the bullet's text
 * (kept raw — the renderer parses it).
 */
export interface ParsedBullet {
  text: string;
  citation?: string;
}

/**
 * Bullet-list section — matches record_thesis `sectionBulletSchema`.
 */
export interface ParsedBulletSection {
  bullets: ParsedBullet[];
}

export type ParsedSection = ParsedTextSection | ParsedBulletSection;

export interface ParsedSections {
  // Text sections.
  snapshot?: ParsedTextSection;
  recentCatalysts?: ParsedTextSection;
  fundamentals?: ParsedTextSection;
  analystConsensus?: ParsedTextSection;
  insiderTechnical?: ParsedTextSection;
  // Bullet sections.
  latestEarnings?: ParsedBulletSection;
  catalystsAndEvents?: ParsedBulletSection;
  bullCase?: ParsedBulletSection;
  bearCase?: ParsedBulletSection;
}

export interface ResearchCitation {
  /** "STRUCTURED:revenue_2025" or "WEB:https://..." */
  raw: string;
  kind: "structured" | "web";
  /** For STRUCTURED: the field key. For WEB: the URL. */
  ref: string;
  /** For WEB: best-effort domain from URL. */
  domain?: string;
}

export function parseCitations(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\[(STRUCTURED|WEB):([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = `${match[1]}:${match[2]}`;
    if (!seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out;
}

export function citationsFromRaw(rawList: string[]): ResearchCitation[] {
  return rawList.map((raw): ResearchCitation => {
    const colon = raw.indexOf(":");
    const kindStr = raw.slice(0, colon).toUpperCase();
    const ref = raw.slice(colon + 1);
    if (kindStr === "WEB") {
      let domain: string | undefined;
      try {
        domain = new URL(ref).hostname;
      } catch {
        /* malformed url — leave domain undefined */
      }
      return { raw, kind: "web", ref, domain };
    }
    return { raw, kind: "structured", ref };
  });
}

/**
 * Bullet-line matcher. Accepts the most common markdown bullet
 * conventions the synthesis model might emit:
 *   - hyphen-bullet      `- foo`
 *   - asterisk-bullet    `* foo`
 *   - bullet-glyph       `• foo` / `◦ foo` / `▪ foo`
 *   - numbered           `1. foo` / `2) foo`
 *
 * We split on those line-starts so each bullet's text is the rest of the
 * line. Multi-line bullets (with wrapped or sub-content) get folded onto
 * one line — Markdown spec says trailing lines without a leading bullet
 * are continuations; we keep them as-is via the lookahead.
 */
const BULLET_LINE_RE =
  /(?:^|\n)\s*(?:[-*•◦▪]|\d+[.)])\s+([^\n]+(?:\n(?!\s*(?:[-*•◦▪]|\d+[.)])\s+)[^\n]+)*)/g;

/**
 * Pull the FIRST [STRUCTURED:...] or [WEB:...] marker out of bullet text,
 * if present. The bullet's text is NOT mutated — the marker stays inline.
 */
function firstCitationOf(text: string): string | undefined {
  const re = /\[(STRUCTURED|WEB):([^\]]+)\]/;
  const match = re.exec(text);
  if (!match) return undefined;
  return `${match[1]}:${match[2]}`;
}

function parseBullets(body: string): ParsedBullet[] {
  const bullets: ParsedBullet[] = [];
  let m: RegExpExecArray | null;
  // Reset lastIndex defensively — global regex state is per-instance.
  BULLET_LINE_RE.lastIndex = 0;
  while ((m = BULLET_LINE_RE.exec(body)) !== null) {
    const text = m[1].trim();
    if (!text) continue;
    const citation = firstCitationOf(text);
    bullets.push(citation !== undefined ? { text, citation } : { text });
  }
  return bullets;
}

export function parseIntoSections(text: string): ParsedSections {
  // Find each section header's index, then slice text between consecutive
  // headers. Headers not present in the model output simply stay undefined.
  const positions: { key: string; start: number; kind: SectionKind }[] = [];
  for (const { key, pattern, kind } of SECTION_HEADERS) {
    const match = pattern.exec(text);
    if (match) positions.push({ key, start: match.index, kind });
  }
  positions.sort((a, b) => a.start - b.start);

  const sections: ParsedSections = {};
  for (let i = 0; i < positions.length; i++) {
    const { key, start, kind } = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1].start : text.length;
    // Strip the header line itself.
    const block = text.slice(start, end);
    const newline = block.indexOf("\n");
    const body = newline >= 0 ? block.slice(newline + 1).trim() : "";
    if (!body) continue;

    if (kind === "bullets") {
      const bullets = parseBullets(body);
      if (bullets.length === 0) {
        // Fallback: model wrote the section as prose despite the prompt
        // asking for bullets. Wrap the body as a single bullet so the
        // section isn't silently dropped — better to render one fat
        // bullet than a missing section. Citation extraction still applies.
        const citation = firstCitationOf(body);
        (sections as Record<string, ParsedBulletSection>)[key] = {
          bullets: [citation !== undefined ? { text: body, citation } : { text: body }],
        };
      } else {
        (sections as Record<string, ParsedBulletSection>)[key] = { bullets };
      }
    } else {
      (sections as Record<string, ParsedTextSection>)[key] = {
        text: body,
        citations: parseCitations(body),
      };
    }
  }
  return sections;
}
