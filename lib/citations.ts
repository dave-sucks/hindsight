/**
 * citations.ts — when a link an agent wrote is a source citation.
 *
 * The rule in one sentence: a markdown link to a web page whose text is a
 * site's name ("[apnews.com](https://apnews.com/…)") is a source citation,
 * drawn as SourceCitation (components/ai-elements/inline-citation.tsx); any
 * other link stays a link. The Market Reviewer writes its sources this way,
 * wrapped in parentheses, so the parentheses go with the link.
 */

/** "apnews.com", "au.investing.com": a site's name, not prose. */
const SITE = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const WEB = /^https?:\/\//i;

export function isSourceLink(text: string, href: string | undefined): href is string {
  return !!href && WEB.test(href) && SITE.test(text.trim());
}

/** A markdown link to a web page: [text](https://…). */
const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
/** One or more source links in parentheses, the way the Market Reviewer cites: "([apnews.com](…))". */
const WRAPPED = /\(\s*((?:\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)[\s,;]*)+)\)/g;

/** The text with the parentheses around source links taken off, so a citation reads as the pill alone. */
export function unwrapSourceLinks(markdown: string): string {
  return markdown.replace(WRAPPED, (whole, links: string) =>
    [...links.matchAll(LINK)].every((m) => isSourceLink(m[1], m[2])) ? links.trim() : whole,
  );
}

export type CitedSegment = { kind: "text"; text: string } | { kind: "source"; url: string; text: string };

/**
 * Plain text with its markdown links split out, for a surface that draws text
 * and no markdown (a stock's Activity). Every web link is a source there; one
 * whose text is prose keeps its words, the pill beside them.
 */
export function citedSegments(text: string): CitedSegment[] {
  const out: CitedSegment[] = [];
  const src = unwrapSourceLinks(text);
  let at = 0;
  for (const m of src.matchAll(LINK)) {
    if (m.index! > at) out.push({ kind: "text", text: src.slice(at, m.index) });
    out.push({ kind: "source", url: m[2], text: m[1] });
    at = m.index! + m[0].length;
  }
  if (at < src.length) out.push({ kind: "text", text: src.slice(at) });
  return out;
}
