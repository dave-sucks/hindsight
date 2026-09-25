/**
 * EXEL, 2026-09-25 — the two rules for the date on file, on the real events.
 *
 * The August 5 8-K: "FDA assigned a Prescription Drug User Fee Act (PDUFA)
 * target action date of December 3, 2026". The September 10 8-K: "The
 * updated Prescription Drug User Fee Act action date is March 3, 2027." The
 * writer saved March 3 (it found the September filing by search). The
 * calendar found only August. A first version of this code would have
 * overwritten March 3 with December 3 on the next save.
 */
import type { CatalystEvent } from "@/lib/market-data/catalyst-calendar";
import { pickCatalystOnFile, resolveEventDate } from "./catalyst-on-file";

const august: CatalystEvent = {
  ticker: "EXEL", company: "EXELIXIS, INC.", kind: "PDUFA", eventDate: "2026-12-03", daysAway: 69,
  announcedDate: "2026-08-05",
  quote: "…FDA assigned a Prescription Drug User Fee Act (PDUFA) target action date of December 3, 2026…",
  url: "https://www.sec.gov/Archives/edgar/data/939767/000093976726000096/exel20260630exhibit991.htm",
} as CatalystEvent;
const september: CatalystEvent = {
  ticker: "EXEL", company: "EXELIXIS, INC.", kind: "PDUFA", eventDate: "2027-03-03", daysAway: 159,
  announcedDate: "2026-09-10",
  quote: "The updated Prescription Drug User Fee Act action date is March 3, 2027.",
  url: "https://www.sec.gov/Archives/edgar/data/939767/000093976726000108/exel-20260910.htm",
} as CatalystEvent;

describe("pickCatalystOnFile — the company's newest statement, not the soonest date", () => {
  it("EXEL: the September filing's March 3 beats the August filing's December 3", () => {
    expect(pickCatalystOnFile([august, september])?.eventDate).toBe("2027-03-03");
    expect(pickCatalystOnFile([september, august])?.eventDate).toBe("2027-03-03");
  });
  it("with only the August filing found, that is what is on file", () => {
    expect(pickCatalystOnFile([august])?.eventDate).toBe("2026-12-03");
  });
  it("a date still ahead beats a past one, however new the past one's telling", () => {
    const past = { ...august, eventDate: "2026-08-01", daysAway: -55, announcedDate: "2026-09-20" } as CatalystEvent;
    expect(pickCatalystOnFile([past, august])?.eventDate).toBe("2026-12-03");
  });
  it("nothing dated is null", () => {
    expect(pickCatalystOnFile([{ ...august, eventDate: null, daysAway: null } as CatalystEvent])).toBeNull();
  });
});

describe("resolveEventDate — a filing fills a missing date and never overwrites the writer's", () => {
  const onFile = { catalystOnFile: pickCatalystOnFile([august]) };

  it("EXEL as it happened: the writer's March 3 stands over the older filing's December 3, with both on the row", () => {
    const r = resolveEventDate({ catalyst_date: "2027-03-03", horizon: "CATALYST", setup_id: "PRE_CATALYST" }, onFile);
    expect(r.iso).toBe("2027-03-03T00:00:00.000Z");
    expect(r.note).toContain("Event date 2027-03-03 as written");
    expect(r.note).toContain("said 2026-12-03");
    expect(r.note).toContain("If the filing is newer, the date is wrong");
  });
  it("the writer's date matching the filing needs no note", () => {
    const r = resolveEventDate({ catalyst_date: "2026-12-03", horizon: "CATALYST" }, onFile);
    expect(r.iso).toBe("2026-12-03T00:00:00.000Z");
    expect(r.note).toBeNull();
  });
  it("no date from the writer on an event-dated thesis: the filing fills it and says so", () => {
    const r = resolveEventDate({ catalyst_date: null, horizon: "CATALYST" }, onFile);
    expect(r.iso).toBe("2026-12-03T00:00:00.000Z");
    expect(r.note).toContain("taken from the company's own filing");
  });
  it("no date and not event-dated: nothing is invented", () => {
    const r = resolveEventDate({ catalyst_date: null, horizon: "COMPOUNDER" }, onFile);
    expect(r.iso).toBeUndefined();
    expect(r.note).toBeNull();
  });
  it("nothing on file: the writer's date is the date", () => {
    const r = resolveEventDate({ catalyst_date: "2027-03-03", horizon: "CATALYST" }, { catalystOnFile: null });
    expect(r.iso).toBe("2027-03-03T00:00:00.000Z");
    expect(r.note).toBeNull();
  });
});
