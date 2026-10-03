/**
 * filing-text.test.ts — which filing a `read` means, and which strings are
 * not a filing at all. The reading itself is replayed through the tool in
 * lib/agent/tools/get-sec-filings.read.replay.test.ts.
 */
import { parseFilingRef } from "./filing-text";

const PTCT = { cik: "1070081", accession: "0001070081-26-000023" };
const DIR = "https://www.sec.gov/Archives/edgar/data/1070081/000107008126000023";

describe("parseFilingRef — a link or an accession number", () => {
  it.each([
    ["the document a filing row links", `${DIR}/tmb-20260921x8k.htm`, { ...PTCT, file: "tmb-20260921x8k.htm" }],
    ["the filing's folder, as the catalyst calendar links an undated one", `${DIR}/`, { ...PTCT, file: null }],
    ["the folder's index page", `${DIR}/0001070081-26-000023-index.htm`, { ...PTCT, file: null }],
    [
      "the index page one level up",
      "https://www.sec.gov/Archives/edgar/data/1070081/0001070081-26-000023-index.htm",
      { ...PTCT, file: null },
    ],
    [
      "EDGAR's inline viewer",
      "https://www.sec.gov/ix?doc=/Archives/edgar/data/1070081/000107008126000023/tmb-20260921x8k.htm",
      { ...PTCT, file: "tmb-20260921x8k.htm" },
    ],
    ["an accession number", "0001070081-26-000023", { cik: null, accession: PTCT.accession, file: null }],
    ["an accession number without its dashes", " 000107008126000023 ", { cik: null, accession: PTCT.accession, file: null }],
  ])("%s", (_what, ref, expected) => {
    expect(parseFilingRef(ref)).toEqual(expected);
  });

  it.each([
    ["another site", "https://www.ptcbio.com/news/2026-09-21"],
    ["a look-alike host", `https://www.sec.gov.example.com/Archives/edgar/data/1070081/000107008126000023/x.htm`],
    ["sec.gov as a username", `https://www.sec.gov@example.com/Archives/edgar/data/1070081/000107008126000023/x.htm`],
    ["plain http", DIR.replace("https:", "http:")],
    ["an EDGAR page that isn't a filing", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=1070081"],
    ["a viewer link out of the archive", "https://www.sec.gov/ix?doc=//example.com/Archives/edgar/data/1/000107008126000023/x.htm"],
    ["a path that climbs", "https://www.sec.gov/ix?doc=/Archives/edgar/data/1070081/000107008126000023/../../x.htm"],
    ["a ticker", "PTCT"],
  ])("refuses %s", (_what, ref) => {
    expect(parseFilingRef(ref)).toBeNull();
  });
});
