/**
 * get_sec_filings — a company's recent SEC filings, with what each one IS.
 *
 * Reads through lib/market-data/sec-filings — the same EDGAR call the
 * trigger evaluator makes for `SEC_EVENT`. Each 8-K comes back with its
 * item codes in plain words and a tier (serious / material / routine), so
 * "8-K, Aug 26" reads "officer or director leaving or joining (5.02)". A
 * failed read says so; it is never reported as "no filings".
 *
 * Insider buying is get_insider_activity (Form 4), not this tool.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";
import { fetchBookFilings } from "@/lib/market-data/sec-filings";
import { describeFilingEvent, WATCHED_FORMS, type SecFiling } from "@/lib/market-data/sec-events";

/** The watched events, plus the periodic reports for context. */
const TOOL_FORMS = [...WATCHED_FORMS, "10-K", "10-Q"];

const TIER_WORD: Record<SecFiling["tier"], string> = {
  RED: "serious",
  MATERIAL: "material",
  CONTEXT: "routine",
};

export const getSecFilings = defineTool({
  description:
    "A company's recent SEC filings from EDGAR, each with what it is: 8-K item codes in plain words (5.02 officer leaving, " +
    "4.02 past financials unreliable, 2.01 acquisition completed), late-report notices, activist stakes (13D), share or bond " +
    "offerings, and the 10-K/10-Q. Each carries a tier — serious, material or routine — and a link to the document. " +
    "The code says what kind of event it was, not whether it's good: read the document before acting. " +
    "For insider buying use get_insider_activity.",
  schema: z.object({
    symbol: z.string().describe("Ticker symbol, e.g. MU"),
    days: z.number().int().min(1).max(365).optional().describe("How far back; defaults to 90."),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => `Pulling $${args.symbol.toUpperCase()} SEC filings`,

  execute: async ({ symbol, days }) => {
    const T = symbol.toUpperCase();
    const window = days ?? 90;
    const source = {
      provider: "SEC EDGAR",
      title: `${T} EDGAR filings`,
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${T}&owner=include&count=40`,
    };
    const read = await fetchBookFilings({ tickers: [T], now: new Date(), lookbackDays: window, forms: TOOL_FORMS });
    const list = read.byTicker.get(T) ?? [];

    if (read.error) {
      const text = `SEC filings unavailable for $${T} — ${read.error}. This is not "nothing filed".`;
      return {
        summary: text,
        data: {
          items: [{ kind: "ticker" as const, ticker: T, tag: "unavailable", text }],
          filings: [] as FilingRow[],
          count: 0,
          error: read.error,
        },
        sources: [source],
      };
    }

    const filings: FilingRow[] = list.map((f) => ({
      type: f.form,
      date: f.filedDate,
      description: describeFilingEvent(f),
      items: f.items,
      tier: f.tier,
      url: f.url,
    }));
    const serious = list.filter((f) => f.tier !== "CONTEXT");
    const summary = list.length
      ? `$${T} — ${list.length} SEC filing${list.length === 1 ? "" : "s"} in ${window} days` +
        (serious.length ? `, ${serious.length} serious or material.` : ", all routine.")
      : `$${T} — no watched SEC filings in the last ${window} days.`;

    return {
      summary,
      data: {
        items: [
          { kind: "generic" as const, text: summary },
          ...list.slice(0, 15).map((f) => ({
            kind: "ticker" as const,
            ticker: T,
            tag: f.filedDate,
            text: `${describeFilingEvent(f)} · ${TIER_WORD[f.tier]}`,
          })),
        ],
        filings,
        count: filings.length,
      },
      sources: [source, ...serious.slice(0, 5).map((f) => ({ provider: "SEC EDGAR", title: `${T} ${describeFilingEvent(f)}`, url: f.url }))],
    };
  },
});

interface FilingRow {
  type: string;
  date: string;
  description: string;
  items: string[];
  tier: SecFiling["tier"];
  url: string;
}
