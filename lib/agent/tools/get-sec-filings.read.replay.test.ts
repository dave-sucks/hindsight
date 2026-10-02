/**
 * get-sec-filings.read.replay.test.ts — an agent can read a filing (DAV-314).
 *
 * 2026-09-24, the Catalyst discovery session. Asked to classify PTCT from its
 * Sep 21 8-K, the chat quoted the filing as announcing an NDA resubmission
 * for sepiapterin with a PDUFA date in March 2027. The filing says nothing of
 * the kind: it is PTC completing its purchase of ST-920, a Fabry gene
 * therapy, and neither word appears in any document of the submission.
 *
 * It was not a bad model day. get_sec_filings returned a list — date, form,
 * item codes, a link — and no tool returned a filing's text, so "read the
 * filing and classify" could only be answered by making the reading up.
 *
 * Replayed through the tool's real entry point against that filing as EDGAR
 * serves it (lib/market-data/__fixtures__/edgar-ptct-8k-2026-09-21, fetched
 * 2026-10-02, untrimmed): the header page, the 8-K, its EX-99.1, and EDGAR's
 * answer to a search for the accession number.
 *
 * On main this fails: `read` is not a field, the call falls through to a
 * search of an empty book, and no text comes back.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { replayTool } from "@/lib/replay";

const ACCESSION = "0001070081-26-000023";
const DIR = "https://www.sec.gov/Archives/edgar/data/1070081/000107008126000023";
const FORM = `${DIR}/tmb-20260921x8k.htm`;
const RELEASE = `${DIR}/tmb-20260921xex99d1.htm`;
const BY_ACCESSION = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${ACCESSION}"`)}`;

const fx = (name: string) =>
  readFileSync(join(__dirname, "../../market-data/__fixtures__/edgar-ptct-8k-2026-09-21", name), "utf8");

/** EDGAR as it answered: these four pages, and a 404 for anything else. Records every URL asked for. */
function edgar(overrides: Record<string, string | null> = {}) {
  const pages: Record<string, string | null> = {
    [`${DIR}/${ACCESSION}-index-headers.html`]: fx(`${ACCESSION}-index-headers.html`),
    [FORM]: fx("tmb-20260921x8k.htm"),
    [RELEASE]: fx("tmb-20260921xex99d1.htm"),
    [BY_ACCESSION]: fx("search-by-accession.json"),
    ...overrides,
  };
  const urls: string[] = [];
  global.fetch = jest.fn(async (url: string | URL) => {
    const u = String(url);
    urls.push(u);
    const body = pages[u];
    return body == null ? new Response("Not Found", { status: 404 }) : new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return urls;
}

type ReadData = {
  text?: string;
  error?: string;
  truncated?: boolean;
  shown?: number;
  total?: number;
  sections?: Array<{ item: string; name: string }>;
  document?: { type: string; url: string };
  filing?: { company: string; form: string; filedDate: string; items: string[] };
};

async function read(args: Record<string, unknown>) {
  const { result, crashed } = await replayTool("get-sec-filings", "getSecFilings", { args });
  expect(crashed).toBe(false);
  return { summary: String(result.summary ?? ""), data: (result.data ?? {}) as ReadData };
}

describe("PTCT's Sep 21 8-K, read instead of guessed at", () => {
  it("returns what the 8-K says — the ST-920 purchase — and not a word of the quote that was invented", async () => {
    const urls = edgar();
    const { summary, data } = await read({ read: FORM });

    expect(typeof data.text).toBe("string");
    const text = data.text!;
    expect(text).toContain("to acquire ST-920, a BLA-stage one-time administered AAV gene therapy product candidate for Fabry disease");
    expect(text).toContain("is expected to be completed in the fourth quarter of 2026");
    for (const invented of ["sepiapterin", "PDUFA", "resubmission", "March 2027"]) {
      expect(text.toLowerCase()).not.toContain(invented.toLowerCase());
    }

    expect(data.filing).toMatchObject({ company: "PTC THERAPEUTICS, INC.", form: "8-K", filedDate: "2026-09-21", items: ["7.01", "8.01", "9.01"] });
    expect(data.document).toMatchObject({ type: "8-K", url: FORM });
    expect(summary).toContain("PTC THERAPEUTICS, INC. 8-K — press release (7.01), other events (8.01), filed 2026-09-21.");
    // Two requests: the filing's header page, then the document.
    expect(urls).toEqual([`${DIR}/${ACCESSION}-index-headers.html`, FORM]);
  });

  it("labels each item section, and leaves out the cover page and the signature block", async () => {
    edgar();
    const { summary, data } = await read({ read: FORM });
    const text = data.text!;

    expect(data.sections!.map((s) => s.item)).toEqual(["7.01", "8.01", "9.01"]);
    expect(text.startsWith("[Item 7.01 — press release]\nItem 7.01. Regulation FD Disclosure.\n")).toBe(true);
    expect(text).toContain("\n\n[Item 8.01 — other events]\nItem 8.01. Other Information.\nOn September 21, 2026, the Company issued a press release");
    expect(text).toContain("[Item 9.01 — exhibits]");
    // "…incorporated by reference into this Item 7.01." is a sentence, not a heading.
    expect(text.match(/\[Item /g)).toHaveLength(3);

    expect(text).not.toContain("Emerging growth company");
    expect(text).not.toContain("Pierre Gravier");
    // The hidden data header (the CIK and "false", twice over) is not text.
    expect(text).not.toContain("0001070081");
    // Quotation marks and apostrophes survive: the words can be quoted.
    expect(text).toContain("(the “Company”)");

    expect(summary).toContain("Cover page and signature block left out.");
    expect(summary).toContain('Not read: its press-release exhibit (EX-99.1) — read it with part:"press_release".');
    expect(data.truncated).toBe(false);
  });

  it("reads the press release by accession number — and it does not say it either", async () => {
    const urls = edgar();
    const { summary, data } = await read({ read: ACCESSION, part: "press_release" });
    const text = data.text!;

    expect(data.document).toMatchObject({ type: "EX-99.1", url: RELEASE });
    expect(text).toContain("PTC Completes Acquisition of ST-920 Fabry Disease Gene Therapy");
    expect(text).toContain("A rolling BLA submission to FDA for accelerated approval of ST-920 is expected to be completed in Q4 2026.");
    for (const invented of ["sepiapterin", "PDUFA", "resubmission", "March 2027"]) {
      expect(text.toLowerCase()).not.toContain(invented.toLowerCase());
    }
    // A paragraph a line; the characters a blanket strip dropped are kept.
    expect(text.split("\n")[0]).toBe("Exhibit 99.1");
    expect(text).toContain("alpha-galactosidase A (α-Gal A) enzyme");
    expect(text).toContain("The company’s strategy");
    // EDGAR's envelope around an exhibit is not part of it.
    expect(text).not.toContain("tmb-20260921xex99d1.htm");

    expect(summary).toContain("Read its press-release exhibit (EX-99.1): 7,883 characters, in data.text.");
    expect(summary).toContain(`Also in this filing, not read: 8-K ${FORM}.`);
    // An accession number's prefix is the filing agent's id, so the company is looked up first.
    expect(urls).toEqual([BY_ACCESSION, `${DIR}/${ACCESSION}-index-headers.html`, RELEASE]);
  });
});

describe("a read that didn't happen says so", () => {
  it("a document EDGAR doesn't return is 'not read' — never empty text", async () => {
    edgar({ [FORM]: null });
    const { summary, data } = await read({ read: FORM });
    expect(data.text).toBeUndefined();
    expect(summary).toMatch(/^Filing not read — EDGAR didn't return tmb-20260921x8k\.htm/);
    expect(summary).toContain("nothing can be said about what it contains");
  });

  it("only EDGAR's archive is read — any other link is refused before a request is made", async () => {
    const urls = edgar();
    const { summary, data } = await read({ read: "https://www.ptcbio.com/news/2026-09-21" });
    expect(urls).toEqual([]);
    expect(data.text).toBeUndefined();
    expect(summary).toContain("is not a filing's link or accession number");
  });

  it("a longer document is cut at the cap, and the cut is written into the text", async () => {
    // Constructed: the real press release with its body four times over.
    const real = fx("tmb-20260921xex99d1.htm");
    const body = real.slice(real.indexOf("<body>") + 6, real.indexOf("</body>"));
    edgar({ [RELEASE]: real.replace(body, body.repeat(4)) });
    const { summary, data } = await read({ read: RELEASE });

    expect(data.truncated).toBe(true);
    expect(data.total).toBeGreaterThan(30_000);
    expect(data.shown).toBeLessThanOrEqual(12_000);
    expect(data.text!.split("\n").pop()).toMatch(/^\[Cut here: [\d,]+ of [\d,]+ characters\. The rest of this document was not read\.\]$/);
    expect(summary).toMatch(/Cut at [\d,]+ of [\d,]+ characters — the rest of this document was not read\./);
  });
});
