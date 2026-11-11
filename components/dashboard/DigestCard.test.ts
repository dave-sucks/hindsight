/**
 * The homepage digest card: two tabs, Portfolio and Market, each showing its
 * own digest under its own date, and a Market tab that says plainly when no
 * market digest has been written yet. The Market tab leads with the Market
 * Reviewer's brief; the dialog holds its digest. Rendered to HTML as the page sends it.
 * The Portfolio text is the start of the LIVE book's Nov 6 digest.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// react-markdown ships as ESM only; the dialog that uses it is closed in every render here.
jest.mock("@/components/ui/ticker-markdown", () => ({ DigestMarkdown: ({ children }: { children: string }) => children }));

import { DigestCard, formatDigestStamp, type DigestTab } from "./DigestCard";
import type { LatestDigest } from "@/lib/actions/digest.actions";

const PORTFOLIO: LatestDigest = {
  id: "pd_1106",
  date: "2026-11-06T00:00:00.000Z",
  narrative: "The portfolio closed the day with a gain of $1,000.00, marking a 1.00% increase in equity, which now stands at $100,000.00.",
  model: "gpt-4o",
  createdAt: "2026-11-07T01:00:35.777Z",
};
const MARKET: LatestDigest = {
  id: "md_1109",
  date: "2026-11-09T00:00:00.000Z",
  brief: "The S&P 500 closed Friday 4% under its 50-day average, and [CEG](thesis:th_ceg) reported before the open.",
  narrative: "### Market overview\n\nStocks bounced Friday.\n\nSources: [Reuters](https://www.reuters.com/markets/us/example)",
  model: "gpt-5.4",
  createdAt: "2026-11-09T12:34:00.000Z",
  runId: "run_md",
};

const render = (market: LatestDigest | null, initialTab: DigestTab = "portfolio") =>
  renderToStaticMarkup(createElement(DigestCard, { portfolio: PORTFOLIO, market, winRate: 0.5, initialTab }));
const tabs = (html: string) => [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1]);

describe("the digest card", () => {
  it("shows both tabs, Portfolio first", () => {
    expect(tabs(render(MARKET))).toEqual(["Portfolio", "Market"]);
    expect(tabs(render(null))).toEqual(["Portfolio", "Market"]);
  });

  it("on Portfolio: the Portfolio Digest under its own date", () => {
    const html = render(MARKET);
    expect(html).toContain(formatDigestStamp(PORTFOLIO));
    expect(html).toContain("The portfolio closed the day with a gain of $1,000.00");
    expect(html).not.toContain("The S&amp;P 500 closed Friday");
  });

  it("on Market: the market brief under its own date, its tokens read as plain names", () => {
    const html = render(MARKET, "market");
    expect(html).toContain(formatDigestStamp(MARKET));
    expect(formatDigestStamp(MARKET)).not.toBe(formatDigestStamp(PORTFOLIO));
    expect(html).toContain("The S&amp;P 500 closed Friday 4% under its 50-day average, and CEG reported before the open.");
    expect(html).not.toContain("The portfolio closed the day");
  });

  it("an empty Market tab says no market digest has been written yet", () => {
    const html = render(null, "market");
    expect(html).toContain("No market digest has been written yet.");
    expect(html).toMatch(/<button[^>]*disabled=""/);
  });

  it("puts no control inside another: the tabs and the preview are siblings", () => {
    const html = render(MARKET);
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*<button/);
  });

  it("dates each digest by its trading day and the time it was written", () => {
    const now = new Date("2026-11-09T15:00:00Z");
    expect(formatDigestStamp(MARKET, now)).toBe("Today, 7:34 AM");
    expect(formatDigestStamp(PORTFOLIO, now)).toBe("Fri Nov 6, 8:00 PM");
  });
});
