/**
 * The catalyst calendar — dated regulatory events, read from the filings the
 * companies themselves made.
 *
 * The Catalyst seat trades dated binaries and has never had a list to search.
 * No vendor we hold carries FDA decision dates, and the FDA cannot publish
 * them: confidentiality bars it from confirming an application even exists
 * until the sponsor makes it public. **The sponsor's own 8-K is therefore the
 * primary source** — "the FDA has assigned a PDUFA target action date of
 * November 22, 2026" is a sentence the company wrote, not a tracker's guess.
 *
 * So: EDGAR full-text search for the phrases companies use, then read the
 * press-release exhibit and take the date out of the sentence that carries it.
 * Measured 2026-09-23 — eight of eight filings gave up their date in 19
 * requests and 7 seconds.
 *
 * Two windows, and they are not the same window:
 *   - **announced** — how far back to look for the filing. A March decision is
 *     usually announced months earlier, so this is generous by default.
 *   - **the event** — when the thing actually happens. This is what the caller
 *     is asking about, and what the rows are filtered on.
 *
 * Nothing is stored. The vendor is the database, as with earnings and filings;
 * a day cache keyed on the accession stops us re-reading a filing whose date
 * cannot change once it is written.
 */

import { loadCompanyList, secUserAgent } from "./sec-filings";

export type CatalystKind = "PDUFA" | "ADCOM" | "READOUT";

export interface CatalystEvent {
  ticker: string;
  company: string;
  kind: CatalystKind;
  /** The dated event, YYYY-MM-DD. Null when the filing named the event without a parseable date. */
  eventDate: string | null;
  /**
   * "day" when the filing gave a day; "month" when it gave only "February 2027",
   * in which case `eventDate` is the first of that month and must be read as
   * approximate. Companies announce a month first and a day later.
   */
  datePrecision: "day" | "month" | null;
  /** Calendar days from now to the event; negative is past, null when undated. */
  daysAway: number | null;
  /** When the company announced it. */
  announcedDate: string;
  /** The company's own sentence — the evidence for the date. */
  quote: string;
  /** The document the date was read out of. */
  url: string;
}

export interface CatalystResults {
  events: CatalystEvent[];
  /** Filings matched by the phrase search, before the event-window filter. */
  matched: number;
  /** Filings read for a date (the rest were beyond the read cap). */
  read: number;
  /** True when the cap stopped us reading everything EDGAR matched. */
  truncated: boolean;
  /** Why nothing could be read, in words. Absent when the read worked. */
  error?: string;
}

/**
 * The phrases each kind is announced with. A lane is data, not code — adding
 * one is a phrase and a label, so the cost of covering a new event type is a
 * line rather than a module.
 */
const LANES: Record<CatalystKind, { phrases: string[]; anchors: string[] }> = {
  PDUFA: {
    phrases: ['"PDUFA target action date"', '"PDUFA date"', '"target action date"'],
    anchors: ["PDUFA", "target action date", "action date"],
  },
  ADCOM: {
    phrases: ['"Advisory Committee meeting"', '"advisory committee will review"'],
    anchors: ["Advisory Committee", "advisory committee meeting"],
  },
  READOUT: {
    phrases: ['"topline data"', '"topline results are expected"'],
    anchors: ["topline data", "topline results", "data readout"],
  },
};

/** EDGAR's full-text search returns ten hits a page. */
const EFTS_PAGE = 10;
/** Pages per phrase — a hundred announcements is more than a quarter ever produces. */
const SEARCH_PAGES = 10;

const MONTH =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December)";
/** "November 22, 2026" — or just "February 2027", which is how a date is first announced. */
const DATE = `(?:${MONTH}\\s+\\d{1,2},\\s+20\\d{2}|${MONTH}\\s+20\\d{2})`;

/**
 * Two shapes the sentence takes: the anchor before the date, or after it.
 *
 * The windows are short on purpose. Press releases are bullet lists with no
 * periods, so a long window walks from one bullet into the next: ANAB's
 * "PDUFA action date of February 2027" was followed by "post-trial hearing
 * scheduled for October 20, 2026" — a court date — and a 250-character window
 * that didn't know month-only dates read the court date as the FDA's
 * (2026-09-24). Knowing "February 2027" is a date makes the nearest one win;
 * the shorter window is the second lock on the same door.
 */
function dateNear(text: string, anchors: string[]): { date: string; precision: "day" | "month"; quote: string } | null {
  for (const anchor of anchors) {
    const a = anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const re of [
      new RegExp(`([^.]{0,90}${a}[^.]{0,120}?(${DATE})[^.]{0,40})`, "i"),
      new RegExp(`([^.]{0,90}(${DATE})[^.]{0,100}?${a}[^.]{0,40})`, "i"),
    ]) {
      const m = re.exec(text);
      // The window can open mid-word; start the evidence at a whole one.
      if (m) {
        const spoken = chooseDate(m[1], m[2]);
        return { ...isoOf(spoken), quote: tidyQuote(m[1]) };
      }
    }
  }
  return null;
}

/**
 * Which date the sentence actually means.
 *
 * A PDUFA date that moves is announced as a move: "setting an updated PDUFA
 * target action date **from September 27, 2026 to December 27, 2026**." Taking
 * the first date read out the superseded one — caught 2026-09-23 against PRAX,
 * where the thesis had the right date and this had the old one. When the
 * sentence says the date changed, the last date in it is the live one.
 */
const MOVED = /\b(?:from|updated|extended|revised|moved|postponed|delayed|new)\b/i;

function chooseDate(sentence: string, first: string): string {
  if (!MOVED.test(sentence)) return first;
  const all = sentence.match(new RegExp(DATE, "gi"));
  return all?.length ? all[all.length - 1] : first;
}

/** The matched window, as a sentence a person can read. */
function tidyQuote(raw: string): string {
  const text = raw.trim().replace(/\s+/g, " ");
  const fromWord = /^[a-z0-9]/i.test(text) ? text.replace(/^\S+\s+/, "") : text;
  return `…${fromWord}…`;
}

/** "November 22, 2026" → 2026-11-22 to the day; "February 2027" → 2027-02-01 to the month. */
function isoOf(spoken: string): { date: string; precision: "day" | "month" } {
  const hasDay = /\d{1,2},/.test(spoken);
  const d = new Date(`${hasDay ? spoken : `${spoken.replace(/\s+(20\d{2})$/, " 1, $1")}`} UTC`);
  if (Number.isNaN(d.getTime())) return { date: spoken, precision: "day" };
  return { date: d.toISOString().slice(0, 10), precision: hasDay ? "day" : "month" };
}

/** Markup out, entities out, whitespace collapsed — the sentence as a person reads it. */
export function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;?/gi, " ")
    .replace(/&amp;?/gi, "&")
    .replace(/&#x?[0-9a-f]+;/gi, " ")
    .replace(/\s+/g, " ");
}

/**
 * Read one filing's documents for the dated sentence. Pure apart from the
 * fetches it is handed, so the parsing is testable without EDGAR.
 */
export function findEventDate(
  documents: Array<{ name: string; text: string }>,
  kind: CatalystKind,
): { date: string; precision: "day" | "month"; quote: string; url: string } | null {
  // The press release carries the date far more often than the 8-K cover page,
  // which usually just points at the exhibit.
  const ordered = [...documents].sort(
    (a, b) => (/ex.?99/i.test(b.name) ? 1 : 0) - (/ex.?99/i.test(a.name) ? 1 : 0),
  );
  for (const doc of ordered) {
    const found = dateNear(plainText(doc.text), LANES[kind].anchors);
    if (found) return { ...found, url: doc.name };
  }
  return null;
}

/** Whole days from `now` to an ISO date, in UTC — the calendar's own arithmetic. */
export function daysUntil(iso: string, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - today) / 86_400_000);
}

// ── The read ───────────────────────────────────────────────────────────────

/** SEC asks for ten requests a second at most; this is comfortably inside it. */
let FETCH_GAP_MS = 220;
export function __setCatalystFetchGap(ms: number): void {
  FETCH_GAP_MS = ms;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A filing's date cannot change once written, so it is read once a day at most. */
const dateCache = new Map<string, { at: number; found: ReturnType<typeof findEventDate> }>();
const DAY_MS = 86_400_000;
export function __resetCatalystCache(): void {
  dateCache.clear();
}

async function secGet(url: string, accept = "text/html"): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await sleep(FETCH_GAP_MS);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": secUserAgent(), Accept: accept },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      if (res.ok) return await res.text();
      if (res.status !== 429 && res.status < 500) return null;
      await sleep(1_000);
    } catch {
      await sleep(600);
    }
  }
  return null;
}

interface EftsHit {
  _id: string;
  _source: { display_names?: string[]; file_date?: string; ciks?: string[] };
}

export interface CatalystSearchInput {
  /** Which lanes to search. Default: PDUFA only — the one that is proven. */
  kinds?: CatalystKind[];
  /** Fence to these companies. Absent = the whole market. */
  tickers?: string[];
  /** Look for announcements filed this many days back. Default 120. */
  announcedWithinDays?: number;
  /** Keep events landing in this window, in days from now. Default: 0 → 70 (the setup's window). */
  eventWindowDays?: [number, number];
  /** Or an explicit event range, YYYY-MM-DD — "the catalysts in June". Overrides the window. */
  from?: string;
  to?: string;
  /** How many filings to open for a date. Default 80 — a quarter's announcements. */
  maxFilings?: number;
  now: Date;
}

export async function searchCatalystEvents(q: CatalystSearchInput): Promise<CatalystResults> {
  const kinds = q.kinds?.length ? q.kinds : (["PDUFA"] as CatalystKind[]);
  const back = q.announcedWithinDays ?? 120;
  const cap = q.maxFilings ?? 80;
  const start = new Date(q.now.getTime() - back * DAY_MS).toISOString().slice(0, 10);
  const end = q.now.toISOString().slice(0, 10);

  const companies = await loadCompanyList(q.now.getTime());
  if (!companies) return empty("SEC's company list couldn't be reached");

  const ciks = q.tickers?.length
    ? q.tickers
        .map((t) => companies.byTicker.get(t.toUpperCase())?.cik)
        .filter((c): c is string => Boolean(c))
    : null;
  if (q.tickers?.length && !ciks?.length) return empty("none of those tickers are on SEC's list");

  const hits = new Map<string, { hit: EftsHit; kind: CatalystKind }>();
  let matched = 0;
  for (const kind of kinds) {
    const text = LANES[kind].phrases.join(" OR ");
    const url =
      `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(text)}&forms=8-K` +
      (ciks ? `&ciks=${ciks.join(",")}` : "") +
      `&dateRange=custom&startdt=${start}&enddt=${end}`;
    let total = 0;
    let seen = 0;
    for (let page = 0; page < SEARCH_PAGES; page++) {
      const raw = await secGet(`${url}&from=${page * EFTS_PAGE}`, "application/json");
      if (!raw) return empty("EDGAR's search couldn't be reached");
      let body: { hits?: { hits?: EftsHit[]; total?: { value?: number } } };
      try {
        body = JSON.parse(raw);
      } catch {
        return empty("EDGAR's search returned something unreadable");
      }
      const page_hits = body.hits?.hits ?? [];
      total = body.hits?.total?.value ?? total;
      seen += page_hits.length;
      for (const hit of page_hits) {
        // Newest wins when a company announced the same event twice.
        if (!hits.has(hit._id)) hits.set(hit._id, { hit, kind });
      }
      if (page_hits.length < EFTS_PAGE || seen >= total) break;
    }
    matched += total;
  }

  const ordered = [...hits.values()].sort((a, b) =>
    (b.hit._source.file_date ?? "").localeCompare(a.hit._source.file_date ?? ""),
  );
  const toRead = ordered.slice(0, cap);

  const events: CatalystEvent[] = [];
  for (const { hit, kind } of toRead) {
    const row = await readFiling(hit, kind);
    if (row) events.push(row);
  }

  // The event window — what the caller is actually asking about.
  const lo = q.from ? null : (q.eventWindowDays?.[0] ?? 0);
  const hi = q.from ? null : (q.eventWindowDays?.[1] ?? 70);
  const inWindow = events.filter((e) => {
    if (!e.eventDate) return false;
    if (q.from || q.to) {
      if (q.from && e.eventDate < q.from) return false;
      if (q.to && e.eventDate > q.to) return false;
      return true;
    }
    return e.daysAway != null && e.daysAway >= (lo as number) && e.daysAway <= (hi as number);
  });

  // A company announces the same date in its 8-K, its quarterly and its
  // milestone update; that is one event, dated once. Keep the newest telling.
  const byEvent = new Map<string, CatalystEvent>();
  for (const e of inWindow) {
    const key = `${e.ticker}:${e.kind}:${e.eventDate}`;
    const held = byEvent.get(key);
    if (!held || e.announcedDate > held.announcedDate) byEvent.set(key, e);
  }
  const deduped = [...byEvent.values()];

  deduped.sort((a, b) => (a.eventDate ?? "").localeCompare(b.eventDate ?? ""));
  return {
    events: deduped,
    matched,
    read: toRead.length,
    truncated: ordered.length > toRead.length,
  };

  async function readFiling(hit: EftsHit, kind: CatalystKind): Promise<CatalystEvent | null> {
    const [adsh] = hit._id.split(":");
    const display = hit._source.display_names?.[0] ?? "";
    // The accession's prefix is the FILING AGENT's id, never the company's —
    // building the archive path from it reads someone else's filings, or none.
    const cik =
      Number((hit._source.ciks?.[0] ?? "").replace(/^0+/, "")) ||
      Number(/CIK (\d+)/.exec(display)?.[1] ?? 0);
    const ticker = /\(([A-Z.\-]{1,6})\)/.exec(display)?.[1] ?? "";
    if (!cik || !ticker) return null;

    const dir = `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh.replace(/-/g, "")}`;
    const cached = dateCache.get(adsh);
    let found = cached && q.now.getTime() - cached.at < DAY_MS ? cached.found : undefined;

    if (found === undefined) {
      // EDGAR's hit id is "accession:file" — the file whose text matched. That
      // is usually the press release itself, so try it before walking the
      // filing's index, which costs a request and finds the same document.
      const matchedFile = hit._id.split(":")[1];
      if (matchedFile && /\.html?$/i.test(matchedFile)) {
        const text = await secGet(`${dir}/${matchedFile}`);
        if (text) found = findEventDate([{ name: matchedFile, text }], kind);
      }
    }

    if (found === undefined || found === null) {
      const idxRaw = await secGet(`${dir}/index.json`, "application/json");
      let names: string[] = [];
      try {
        names = (JSON.parse(idxRaw ?? "{}") as { directory?: { item?: Array<{ name: string }> } })
          .directory?.item?.filter((i) => /\.html?$/i.test(i.name)).map((i) => i.name) ?? [];
      } catch {
        names = [];
      }
      const docs: Array<{ name: string; text: string }> = [];
      // The exhibit first — four documents is plenty for an 8-K.
      const exhibitFirst = names.sort((a, b) => (/ex.?99/i.test(b) ? 1 : 0) - (/ex.?99/i.test(a) ? 1 : 0));
      for (const name of exhibitFirst.slice(0, 4)) {
        const text = await secGet(`${dir}/${name}`);
        if (text) docs.push({ name, text });
        if (findEventDate(docs, kind)) break;
      }
      found = findEventDate(docs, kind);
      dateCache.set(adsh, { at: q.now.getTime(), found });
    }

    const announcedDate = hit._source.file_date ?? "";
    return {
      ticker,
      company: display.split("(")[0].trim(),
      kind,
      eventDate: found?.date ?? null,
      datePrecision: found?.precision ?? null,
      daysAway: found ? daysUntil(found.date, q.now) : null,
      announcedDate,
      quote: found?.quote ?? "",
      url: found ? `${dir}/${found.url}` : `${dir}/`,
    };
  }
}

function empty(error: string): CatalystResults {
  return { events: [], matched: 0, read: 0, truncated: false, error };
}
