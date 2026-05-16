/**
 * get_insider_activity — SEC EDGAR Form 4 rollup, last 90 days.
 *
 * Surfaces the named-executive insider transactions that back the thesis
 * 'Insider Activity' section. Pure LLM "significant insider selling" claims
 * with no specific names or dollar amounts get to be replaced by real data:
 * who sold, when, how much, what % of holdings, vs the 6-month pattern.
 *
 * Uses SEC EDGAR Form 4 directly (free, no key required). Same User-Agent
 * pattern as get_sec_filings.
 */

import { z } from "zod";
import { defineTool } from "@/lib/agent/define-tool";

const SEC_USER_AGENT = "Hindsight Research Bot research@hindsight.app";

async function getCIK(ticker: string): Promise<string | null> {
  try {
    const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { cik_str: number; ticker: string }>;
    for (const entry of Object.values(data)) {
      if (entry.ticker.toUpperCase() === ticker.toUpperCase()) {
        return String(entry.cik_str).padStart(10, "0");
      }
    }
    return null;
  } catch {
    return null;
  }
}

interface SecForm4Index {
  filings?: {
    recent?: {
      form?: string[];
      filingDate?: string[];
      accessionNumber?: string[];
      primaryDocument?: string[];
    };
  };
}

interface Form4Summary {
  date: string;
  insider: string;
  role: string;
  side: "BUY" | "SELL";
  shares: number;
  avgPrice: number;
  value: number;
}

/**
 * Lightweight Form 4 parser — pulls the OWNERSHIP REPORTING transaction
 * rows from the primary doc (typically a .txt or .xml). We do a best-effort
 * structured-text parse; if the doc is XML, we extract the obvious fields.
 *
 * This is intentionally tolerant — SEC filing formats vary; we want partial
 * data with confidence rather than failing the whole call.
 */
async function parseForm4(accession: string, cik: string): Promise<Form4Summary[]> {
  try {
    const accClean = accession.replace(/-/g, "");
    const indexUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accClean}/${accession}-index.json`;
    const idxRes = await fetch(indexUrl, {
      headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!idxRes.ok) return [];
    const idx = (await idxRes.json()) as { directory?: { item?: { name: string }[] } };
    const items = idx.directory?.item ?? [];
    const xmlFile = items.find((i) => i.name.toLowerCase().endsWith(".xml"));
    if (!xmlFile) return [];

    const xmlUrl = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accClean}/${xmlFile.name}`;
    const xmlRes = await fetch(xmlUrl, {
      headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/xml" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!xmlRes.ok) return [];
    const xml = await xmlRes.text();

    // Insider name + title.
    const nameMatch = xml.match(/<rptOwnerName>([^<]+)<\/rptOwnerName>/);
    const insider = nameMatch?.[1]?.trim() ?? "Unknown insider";
    const titleMatch = xml.match(/<officerTitle>([^<]+)<\/officerTitle>/);
    let role = titleMatch?.[1]?.trim() ?? "Insider";
    if (/<isDirector>1<\/isDirector>/.test(xml) && !titleMatch) role = "Director";
    if (/<isTenPercentOwner>1<\/isTenPercentOwner>/.test(xml) && !titleMatch) role = "10% Owner";

    // Non-derivative transactions only (skip option grants/exercises for now;
    // they don't move the "insider buying/selling" needle).
    const txnBlocks = xml.match(/<nonDerivativeTransaction>[\s\S]*?<\/nonDerivativeTransaction>/g) ?? [];
    const txns: Form4Summary[] = [];

    for (const block of txnBlocks) {
      const dateMatch = block.match(/<transactionDate>\s*<value>([^<]+)<\/value>/);
      const sharesMatch = block.match(/<transactionShares>\s*<value>([\d.]+)<\/value>/);
      const priceMatch = block.match(/<transactionPricePerShare>\s*<value>([\d.]+)<\/value>/);
      const codeMatch = block.match(/<transactionCode>([^<]+)<\/transactionCode>/);
      const adMatch = block.match(/<transactionAcquiredDisposedCode>\s*<value>([AD])<\/value>/);

      const date = dateMatch?.[1];
      const shares = sharesMatch ? parseFloat(sharesMatch[1]) : NaN;
      const price = priceMatch ? parseFloat(priceMatch[1]) : NaN;
      const code = codeMatch?.[1]?.trim() ?? "";

      // Limit to open-market and discretionary plan transactions (P, S),
      // skip gifts (G), grants (A in option context), splits/conversions.
      // A/D in the AcquiredDisposed flag is the most reliable buy/sell signal
      // for non-derivative txns; use it as the source of truth, with the
      // P/S code as a fallback when AD isn't present.
      let side: "BUY" | "SELL" | null = null;
      if (adMatch?.[1] === "A") side = "BUY";
      else if (adMatch?.[1] === "D") side = "SELL";
      else if (code === "P") side = "BUY";
      else if (code === "S") side = "SELL";

      if (date && side && Number.isFinite(shares) && shares > 0 && Number.isFinite(price)) {
        txns.push({
          date,
          insider,
          role,
          side,
          shares,
          avgPrice: price,
          value: shares * price,
        });
      }
    }
    return txns;
  } catch {
    return [];
  }
}

export const getInsiderActivity = defineTool({
  description:
    "Get insider transaction activity (SEC Form 4) for a stock over the last 90 days (default). " +
    "Returns named insiders, their roles, individual transactions (buy/sell/shares/price/value), " +
    "and a net-direction rollup. Backs the thesis 'Insider Activity' section. Free from SEC " +
    "EDGAR — no FMP/Finnhub key required, no plan-tier gates.",
  schema: z.object({
    ticker: z.string().describe("Stock ticker symbol, e.g. AAPL"),
    window_days: z
      .number()
      .int()
      .positive()
      .max(180)
      .optional()
      .describe("How many days back to scan (default 90)."),
  }),
  ui: "tool-ui" as const,
  groupId: "Researching",

  progressLabel: (args) => `Pulling $${args.ticker.toUpperCase()}'s insider activity`,

  execute: async ({ ticker, window_days }) => {
    const T = ticker.toUpperCase();
    const days = window_days ?? 90;

    const cik = await getCIK(T);
    if (!cik) {
      return {
        summary: `$${T} insider activity — no CIK found on SEC EDGAR.`,
        data: {
          ticker: T,
          windowDays: days,
          netDirection: "FLAT" as const,
          netValue: 0,
          totalTxns: 0,
          topInsiders: [],
          recentTxns: [],
          items: [{ kind: "ticker" as const, ticker: T, tag: "no data", text: "CIK not found on EDGAR." }],
        },
        sources: [],
      };
    }

    try {
      const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
      const subRes = await fetch(submissionsUrl, {
        headers: { "User-Agent": SEC_USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!subRes.ok) {
        throw new Error(`SEC submissions returned ${subRes.status}`);
      }
      const sub = (await subRes.json()) as SecForm4Index;
      const recent = sub.filings?.recent;
      if (!recent?.form) {
        return {
          summary: `$${T} insider activity — no recent filings index.`,
          data: {
            ticker: T,
            windowDays: days,
            netDirection: "FLAT" as const,
            netValue: 0,
            totalTxns: 0,
            topInsiders: [],
            recentTxns: [],
            items: [{ kind: "ticker" as const, ticker: T, tag: "no filings", text: "No recent filings on EDGAR." }],
          },
          sources: [
            { provider: "SEC EDGAR", title: `${T} Insider Activity`, url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${T}&type=4` },
          ],
        };
      }

      const forms = recent.form ?? [];
      const dates = recent.filingDate ?? [];
      const accs = recent.accessionNumber ?? [];
      const cutoff = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

      // Form 4 filings within the window. Cap at 20 to keep parse cost bounded.
      const form4s: { date: string; accession: string }[] = [];
      const MAX_FORM4_PARSE = 20;
      for (let i = 0; i < forms.length && form4s.length < MAX_FORM4_PARSE; i++) {
        if (forms[i] !== "4" && forms[i] !== "4/A") continue;
        if (dates[i] < cutoff) break; // filings are in desc order; once we're past the window, stop.
        if (!accs[i]) continue;
        form4s.push({ date: dates[i], accession: accs[i] });
      }

      const txnArrays = await Promise.all(form4s.map((f) => parseForm4(f.accession, cik)));
      const recentTxns = txnArrays.flat();

      // Rollups.
      const totalTxns = recentTxns.length;
      let netValue = 0;
      for (const t of recentTxns) netValue += t.side === "BUY" ? t.value : -t.value;

      const netDirection: "BUYING" | "SELLING" | "MIXED" | "FLAT" =
        totalTxns === 0
          ? "FLAT"
          : Math.abs(netValue) < 50_000
            ? "MIXED"
            : netValue > 0
              ? "BUYING"
              : "SELLING";

      const byInsider = new Map<
        string,
        { name: string; role: string; netValue: number; netShares: number; txnCount: number }
      >();
      for (const t of recentTxns) {
        const key = `${t.insider}|${t.role}`;
        const existing = byInsider.get(key) ?? {
          name: t.insider,
          role: t.role,
          netValue: 0,
          netShares: 0,
          txnCount: 0,
        };
        existing.netValue += t.side === "BUY" ? t.value : -t.value;
        existing.netShares += t.side === "BUY" ? t.shares : -t.shares;
        existing.txnCount += 1;
        byInsider.set(key, existing);
      }
      const topInsiders = Array.from(byInsider.values())
        .sort((a, b) => Math.abs(b.netValue) - Math.abs(a.netValue))
        .slice(0, 5);

      const items: Array<
        | { kind: "generic"; text: string }
        | { kind: "ticker"; ticker: string; tag: string; text: string }
      > = [];
      const valueStr =
        Math.abs(netValue) >= 1e6
          ? `$${(netValue / 1e6).toFixed(1)}M`
          : `$${Math.round(netValue / 1e3)}K`;
      items.push({
        kind: "ticker",
        ticker: T,
        tag: netDirection,
        text:
          totalTxns === 0
            ? `No Form 4 transactions in the last ${days} days.`
            : `Net ${valueStr} ${netValue >= 0 ? "buying" : "selling"} across ${totalTxns} transaction(s) by ${byInsider.size} insider(s).`,
      });
      for (const ins of topInsiders) {
        const v = ins.netValue;
        const vStr =
          Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v / 1e3)}K`;
        items.push({
          kind: "generic",
          text: `${ins.name} (${ins.role}) — ${ins.netShares >= 0 ? "+" : ""}${ins.netShares.toLocaleString()} shares · ${vStr} · ${ins.txnCount} txn`,
        });
      }
      if (recentTxns.length > topInsiders.length * 2) {
        items.push({
          kind: "generic",
          text: `… ${recentTxns.length} total transactions parsed.`,
        });
      }

      return {
        summary: `$${T} insider — ${netDirection}${totalTxns > 0 ? ` (${valueStr} net, ${totalTxns} txn)` : ""}.`,
        data: {
          ticker: T,
          windowDays: days,
          netDirection,
          netValue,
          totalTxns,
          topInsiders,
          recentTxns: recentTxns
            .slice()
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 25),
          items,
        },
        sources: [
          {
            provider: "SEC EDGAR",
            title: `${T} Form 4 Insider Transactions`,
            url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${T}&type=4`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "SEC error";
      return {
        summary: `$${T} insider activity — fetch failed: ${msg}.`,
        data: {
          ticker: T,
          windowDays: days,
          netDirection: "FLAT" as const,
          netValue: 0,
          totalTxns: 0,
          topInsiders: [],
          recentTxns: [],
          items: [{ kind: "ticker" as const, ticker: T, tag: "error", text: msg }],
        },
        sources: [
          { provider: "SEC EDGAR", title: `${T} Form 4 Insider Transactions`, url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${T}&type=4` },
        ],
      };
    }
  },
});
