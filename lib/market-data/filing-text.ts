/**
 * Filing text — what one filing says, read off EDGAR.
 *
 * `get_sec_filings` lists filings: a date, a form, item codes, a link. No tool
 * returned a filing's words and a chat cannot open a link, so every "read the
 * filing first" asked for something no agent could do. Asked to classify PTCT
 * from its 2026-09-21 8-K, a chat quoted a sentence about a drug and an FDA
 * date. The filing is about buying a gene therapy and names neither.
 *
 * The fetch and the strip are the catalyst calendar's — the same polite SEC
 * client (`secGet`), the same markup-out pass (`plainText`). This adds what a
 * reader needs and a date parser doesn't: the paragraphs kept apart, the
 * punctuation kept, each 8-K item section labelled, and a cap that says where
 * it cut.
 *
 * Nothing is stored. EDGAR is the database, as with the search.
 */

import { plainText, secGet } from "./catalyst-calendar";
import { ITEM_NAMES } from "./sec-events";

/** Characters of one document a read returns — about 3,000 tokens. */
export const FILING_TEXT_CAP = 12_000;

// ── Which filing ────────────────────────────────────────────────────────────

export interface FilingRef {
  /** The company's CIK, when the link carried it. An accession number alone doesn't. */
  cik: string | null;
  /** Dashed, as EDGAR writes it: 0001070081-26-000023. */
  accession: string;
  /** The document the link points at; null for the filing as a whole. */
  file: string | null;
}

/**
 * A filing's link or accession number → where it lives. Null when it is
 * neither. Only EDGAR's own archive is accepted: this reads filings, not the
 * web.
 */
export function parseFilingRef(ref: string): FilingRef | null {
  const s = ref.trim();
  const bare = /^(\d{10})-?(\d{2})-?(\d{6})$/.exec(s);
  if (bare) return { cik: null, accession: `${bare[1]}-${bare[2]}-${bare[3]}`, file: null };

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !/^(www\.)?sec\.gov$/i.test(u.hostname)) return null;
  // EDGAR's inline viewer wraps the document: /ix?doc=/Archives/edgar/data/…
  const path = u.pathname === "/ix" ? (u.searchParams.get("doc") ?? "") : u.pathname;

  const inFolder = /^\/Archives\/edgar\/data\/(\d{1,10})\/(\d{10})(\d{2})(\d{6})(?:\/([\w\-][\w.\-]*)?)?$/.exec(path);
  if (inFolder) {
    const [, cik, a, b, c, name] = inFolder;
    const file = name && !/-index(-headers)?\.html?$/i.test(name) ? name : null;
    return { cik: String(Number(cik)), accession: `${a}-${b}-${c}`, file };
  }
  // The filing's index page or full submission, one level up.
  const index = /^\/Archives\/edgar\/data\/(\d{1,10})\/(\d{10}-\d{2}-\d{6})(?:-index\.html?|\.txt)$/.exec(path);
  return index ? { cik: String(Number(index[1])), accession: index[2], file: null } : null;
}

// ── What is in it ───────────────────────────────────────────────────────────

export interface FilingDocument {
  /** EDGAR's own type — "8-K", "EX-99.1", "GRAPHIC", "XML". */
  type: string;
  name: string;
  description: string;
}

export interface FilingHeader {
  /** As filed — "8-K", "8-K/A", "10-Q". */
  form: string;
  /** YYYY-MM-DD. */
  filedDate: string | null;
  company: string;
  /** 8-K item codes; empty for other forms. */
  items: string[];
  /** In filing order — the form itself first, then its exhibits. */
  documents: FilingDocument[];
}

const isoDay = (m: RegExpExecArray | null) => (m ? `${m[1]}-${m[2]}-${m[3]}` : null);

/**
 * Read EDGAR's header page for a filing (`<accession>-index-headers.html`):
 * the form, the date, and every document with the type EDGAR gave it. The
 * type is what says which document is the press release — file names don't
 * ("ef20081922_ex99-1.htm", "tmb-20260921xex99d1.htm", "pressrelease.htm").
 */
export function parseFilingHeader(raw: string): FilingHeader | null {
  const sgml = raw.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const form = /CONFORMED SUBMISSION TYPE:[ \t]*(\S.*)/.exec(sgml)?.[1].trim();
  if (!form) return null;
  const documents = [
    ...sgml.matchAll(/<DOCUMENT>\s*<TYPE>([^\n<]*)\s*<SEQUENCE>\d+\s*<FILENAME>([^\n<]*)(?:\s*<DESCRIPTION>([^\n<]*))?/g),
  ].map((m) => ({ type: m[1].trim(), name: m[2].trim(), description: (m[3] ?? "").trim() }));
  return {
    form,
    filedDate: isoDay(/FILED AS OF DATE:\s*(\d{4})(\d{2})(\d{2})/.exec(sgml)),
    company: /COMPANY CONFORMED NAME:[ \t]*(\S.*)/.exec(sgml)?.[1].trim() ?? "",
    items: [...sgml.matchAll(/<ITEMS>(\d\.\d{2})/g)].map((m) => m[1]),
    documents,
  };
}

const isHtml = (d: FilingDocument) => /\.html?$/i.test(d.name);
/** The form or one of its written exhibits — not the charts, data files and viewer pages filed beside them. */
const isReading = (d: FilingDocument) => isHtml(d) && !/^(EX-101|XML|GRAPHIC|JSON|ZIP|EXCEL)/i.test(d.type);
/** EX-99 is where a press release is filed. */
const isPressRelease = (d: FilingDocument) => isReading(d) && /^EX-99/i.test(d.type);

// ── The words ───────────────────────────────────────────────────────────────

const BREAK = "\u0001";
const NAMED: Record<string, string> = {
  lt: "<", gt: ">", quot: '"', apos: "'", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—",
};

/**
 * A numeric entity as the character it stands for. `plainText` blanks them,
 * which is fine for finding a date and wrong for quoting: "the Company’s"
 * came out "the Company s" and "α-Gal A" came out "-Gal A". The three that
 * are markup stay entities until the tags are gone.
 */
function entityChar(code: number): string {
  if (code === 160) return " ";
  if (code === 60) return "&lt;";
  if (code === 62) return "&gt;";
  if (code === 38) return "&amp;";
  // Zero-width characters — typesetting, not text.
  if (code === 173 || (code >= 8203 && code <= 8207) || code === 65279) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return " ";
  }
}

/**
 * One filing document as a person reads it: a paragraph a line, the markup,
 * the hidden data header and EDGAR's envelope gone.
 */
export function filingText(html: string): string {
  return html
    // An exhibit comes wrapped in EDGAR's envelope; the document starts after <TEXT>.
    .replace(/^\s*<DOCUMENT>[\s\S]*?<TEXT>/i, "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(head|script|style|ix:header)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/&#(x?)([0-9a-f]+);/gi, (_, hex: string, n: string) => entityChar(parseInt(n, hex ? 16 : 10)))
    .replace(/<\/(?:p|div|tr|li|h[1-6]|table|ul|ol)\s*>|<br\s*\/?>/gi, BREAK)
    .split(BREAK)
    .map((block) => plainText(block).replace(/&([a-z]+);/gi, (whole, name: string) => NAMED[name.toLowerCase()] ?? whole).trim())
    .filter(Boolean)
    .join("\n");
}

export interface ItemSection {
  /** The 8-K item code — "8.01". */
  item: string;
  /** What that code means, in plain words. */
  name: string;
  /** Characters in the section, before any cap. */
  chars: number;
}

/** An item heading opens a line; "…incorporated by reference into this Item 7.01." does not. */
const ITEM_HEADING = /^item\s+(\d\.\d{2})\b/i;
const SIGNATURE = /^signatures?\.?$/i;

/**
 * An 8-K's body, with each item section under a label that says what the item
 * is. The cover page (the registrant's address and a row of checkboxes) and
 * the signature block carry nothing an analyst reads; they are left out, and
 * the caller says so. A document with no item headings comes back as it is.
 */
export function labelItems(text: string): { text: string; sections: ItemSection[]; trimmed: boolean } {
  const lines = text.split("\n");
  const first = lines.findIndex((l) => ITEM_HEADING.test(l));
  if (first < 0) return { text, sections: [], trimmed: false };
  const signed = lines.findIndex((l, i) => i > first && SIGNATURE.test(l));
  const body = lines.slice(first, signed < 0 ? undefined : signed);

  const parts: Array<{ item: string; lines: string[] }> = [];
  for (const line of body) {
    const item = ITEM_HEADING.exec(line)?.[1];
    if (item && item !== parts[parts.length - 1]?.item) parts.push({ item, lines: [] });
    parts[parts.length - 1].lines.push(line);
  }
  const sections = parts.map((p) => ({
    item: p.item,
    name: ITEM_NAMES[p.item] ?? "item",
    chars: p.lines.join("\n").length,
  }));
  return {
    text: parts.map((p, i) => `[Item ${p.item} — ${sections[i].name}]\n${p.lines.join("\n")}`).join("\n\n"),
    sections,
    trimmed: true,
  };
}

/**
 * Cut at the cap, on a paragraph or a word, never mid-word — and say so in
 * the text itself, so the cut travels with the words wherever they are read.
 */
function capped(text: string): { text: string; shown: number; cut: boolean } {
  if (text.length <= FILING_TEXT_CAP) return { text, shown: text.length, cut: false };
  const para = text.lastIndexOf("\n", FILING_TEXT_CAP);
  const at = para > FILING_TEXT_CAP * 0.8 ? para : text.lastIndexOf(" ", FILING_TEXT_CAP);
  const kept = text.slice(0, at > 0 ? at : FILING_TEXT_CAP).trimEnd();
  const n = (x: number) => x.toLocaleString("en-US");
  return {
    text: `${kept}\n[Cut here: ${n(kept.length)} of ${n(text.length)} characters. The rest of this document was not read.]`,
    shown: kept.length,
    cut: true,
  };
}

// ── The read ────────────────────────────────────────────────────────────────

export interface FilingRead {
  filing: {
    company: string;
    form: string;
    filedDate: string | null;
    accession: string;
    items: string[];
    /** The filing's folder on sec.gov. */
    url: string;
  };
  /** The document that was read. */
  document: { type: string; name: string; url: string; isPressRelease: boolean };
  text: string;
  sections: ItemSection[];
  /** The cover page and signature block were left out (an 8-K's own body). */
  trimmed: boolean;
  /** Characters returned, and characters the document has. */
  shown: number;
  total: number;
  cut: boolean;
  /** The filing's other written documents — the form itself, its exhibits. */
  others: Array<{ type: string; description: string; url: string; isPressRelease: boolean }>;
}

export type FilingReadResult = ({ ok: true } & FilingRead) | { ok: false; error: string };

const fail = (error: string): FilingReadResult => ({ ok: false, error });

/** The company an accession number belongs to — its prefix is the filing agent's id, not the company's. */
async function cikOf(accession: string): Promise<{ cik: string } | { error: string }> {
  const raw = await secGet(
    `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${accession}"`)}`,
    "application/json",
  );
  if (!raw) return { error: "EDGAR's search couldn't be reached to look up that accession number. Pass the filing's link instead." };
  let hits: Array<{ _id: string; _source: { ciks?: string[] } }> = [];
  try {
    hits = (JSON.parse(raw) as { hits?: { hits?: typeof hits } }).hits?.hits ?? [];
  } catch {
    return { error: "EDGAR's search returned something unreadable. Pass the filing's link instead." };
  }
  // The search is over text too — a later filing can mention this number.
  const cik = hits.find((h) => h._id.startsWith(`${accession}:`))?._source.ciks?.[0];
  return cik ? { cik: String(Number(cik)) } : { error: `EDGAR's search has no filing with accession number ${accession}. Pass the filing's link instead.` };
}

/**
 * Read one document of one filing: the filing itself, or its press-release
 * exhibit. Two requests for a link, three for an accession number. Fails in
 * words — a read that didn't happen never comes back as empty text.
 */
export async function readFilingText(q: { ref: string; part?: "filing" | "press_release" }): Promise<FilingReadResult> {
  const ref = parseFilingRef(q.ref);
  if (!ref) {
    return fail(
      `"${q.ref}" is not a filing's link or accession number. Pass the url from a filing row ` +
        "(https://www.sec.gov/Archives/edgar/data/…) or an accession number like 0001070081-26-000023.",
    );
  }
  let cik = ref.cik;
  if (!cik) {
    const found = await cikOf(ref.accession);
    if ("error" in found) return fail(found.error);
    cik = found.cik;
  }

  const dir = `https://www.sec.gov/Archives/edgar/data/${cik}/${ref.accession.replace(/-/g, "")}`;
  const headerRaw = await secGet(`${dir}/${ref.accession}-index-headers.html`);
  const header = headerRaw ? parseFilingHeader(headerRaw) : null;
  if (!header) return fail(`EDGAR didn't return filing ${ref.accession} (${dir}/).`);

  const main = header.documents[0];
  const named = ref.file ? (header.documents.find((d) => d.name === ref.file) ?? { type: "", name: ref.file, description: "" }) : null;
  const wanted =
    q.part === "press_release"
      ? header.documents.find(isPressRelease)
      : q.part === "filing"
        ? main
        : (named ?? main);

  const describe = (d: FilingDocument) => ({
    type: d.type,
    description: d.description && d.description !== d.type ? d.description : "",
    url: `${dir}/${d.name}`,
    isPressRelease: isPressRelease(d),
  });
  const written = header.documents.filter(isReading);
  const listed = written.map((d) => `${d.type} ${d.name}`).join(", ") || "none";
  if (!wanted) {
    return fail(
      q.part === "press_release"
        ? `This ${header.form} has no press-release exhibit (EX-99). Its written documents: ${listed}.`
        : `Filing ${ref.accession} lists no documents.`,
    );
  }
  if (!isHtml(wanted)) {
    return fail(`${wanted.name} is not an HTML document, and only a filing's HTML documents can be read. This filing's: ${listed}.`);
  }

  const html = await secGet(`${dir}/${wanted.name}`);
  if (!html) return fail(`EDGAR didn't return ${wanted.name} (${dir}/${wanted.name}).`);

  const clean = filingText(html);
  if (!clean) return fail(`${wanted.name} has no text to read — it may be an image or a scan.`);
  // Item sections are an 8-K's own structure; an exhibit or a 10-Q is left as written.
  const isEightK = wanted === main && /^8-K/i.test(header.form);
  const labelled = isEightK ? labelItems(clean) : { text: clean, sections: [], trimmed: false };
  const { text, shown, cut } = capped(labelled.text);

  return {
    ok: true,
    filing: {
      company: header.company,
      form: header.form,
      filedDate: header.filedDate,
      accession: ref.accession,
      items: header.items,
      url: `${dir}/`,
    },
    document: { type: wanted.type, name: wanted.name, url: `${dir}/${wanted.name}`, isPressRelease: isPressRelease(wanted) },
    text,
    sections: labelled.sections,
    trimmed: labelled.trimmed,
    shown,
    total: labelled.text.length,
    cut,
    others: written.filter((d) => d.name !== wanted.name).map(describe),
  };
}
