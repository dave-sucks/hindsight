/**
 * Shared trade-email card primitive.
 *
 * One render path for all four trade emails (proposal-pending buy / sell,
 * trade-opened, trade-closed). The visual language mirrors the in-app
 * /trades/[id] page:
 *
 *   - Header sits OUTSIDE the card: small-caps eyebrow + h1 + status badges.
 *     The h1 carries the whole "{Analyst} {verb} {qty} shares of {TICKER}
 *     [for ±X% gain]" sentence so the email's takeaway is one line.
 *
 *   - Stock row: logo + ticker on the left, current price on the right
 *     (entry → current for sales). The sale gain pill sits inline next to
 *     the ticker. There is no separate "Sold" status badge on the row.
 *
 *   - Key/value rows: left label `light gray`, right value
 *     `near-black + medium weight + tabular-nums`. Same rhythm as the
 *     InfoRow primitive in the app.
 *
 *   - Reasoning: full-width prose under a small uppercase label. No
 *     left/right split — long sentences need the width.
 *
 *   - CTA: footer banner with copy on the left and an Open button on the
 *     right that links into Hindsight.
 *
 *   - Footer: legal/automated-message line.
 *
 * Color tokens (TRADE_CARD_COLORS) mirror the app's CSS variables — emerald
 * for positive, red for negative, slate for muted, neutral grays for chrome.
 * Padding is intentionally lighter than the previous templates' 20px — the
 * user runs the app at much tighter row density.
 */

// ─── Tokens ──────────────────────────────────────────────────────────────────
// Email-safe hex equivalents of the app's CSS variables. Keep these in sync
// with app/globals.css if the brand palette shifts.

export const TRADE_CARD_COLORS = {
  pageBg: "#ffffff",
  cardBg: "#ffffff",
  cardBorder: "#e5e7eb",
  rowBorder: "#f1f5f9",
  textPrimary: "#0f172a",
  textMuted: "#64748b",
  textFaint: "#94a3b8",
  chipBg: "#f1f5f9",
  chipText: "#334155",
  logoBg: "#f8fafc",
  positive: "#22c55e",      // emerald-500 (CLAUDE.md: positive ONLY)
  positiveBg: "#dcfce7",    // emerald-100
  negative: "#ef4444",      // red-500 (CLAUDE.md: negative ONLY)
  negativeBg: "#fee2e2",    // red-100
  amber: "#92400e",         // amber-900 text
  amberBg: "#fffbeb",       // amber-50
  amberBorder: "#fbbf24",   // amber-400
  liveBg: "#fee2e2",        // red-100
  liveText: "#b91c1c",      // red-700
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type TradeAction = "BUY" | "SELL";
export type TradeTense = "PROPOSAL" | "EXECUTED";

export interface TradeCardData {
  /** Whose decision this is. */
  analystName: string;

  /** BUY = entry/add; SELL = exit/trim. Drives Bought/Sold/Shorted/Covered verb + Target vs Exit row. */
  action: TradeAction;
  /** PROPOSAL pre-fills "Est." prefixes + the yellow Proposed badge. EXECUTED uses past tense. */
  tense: TradeTense;

  /** LONG/SHORT controls Bought-vs-Shorted, Sold-vs-Covered. */
  direction: "LONG" | "SHORT";
  /** Paper/Live badge in the header. */
  environment: "PAPER" | "LIVE";

  /** Ticker symbol; rendered uppercase. */
  ticker: string;
  /** Optional human name (e.g. "Marvell Technology"). When present, shown under the ticker. */
  tickerName?: string | null;

  qty: number;

  /** For BUY: the executed/proposed entry price. For SELL: the original entry price (anchor for gain calc). */
  entryPrice: number;
  /** For SELL: the realized/proposed exit price. For BUY: omit (use targetPrice instead). */
  exitPrice?: number;
  /** Live mid quote — shown on the right of the stock row. Defaults to entry/exit when omitted. */
  currentPrice?: number | null;
  /** For BUY only — fills the "Target" row. */
  targetPrice?: number | null;
  /** For BUY only — fills the "Stop loss" row. */
  stopLoss?: number | null;

  /** Always rendered. For BUY = qty * entry; for SELL = qty * exit. Caller computes. */
  marketValue: number;

  /** For SELL only — realized $ + %. The card shows the % inline on the header and the $ in the rows. */
  realizedPnl?: number | null;
  realizedPnlPct?: number | null;

  openedAt?: Date | null;
  closedAt?: Date | null;

  /** Full-width body text under a "Reasoning" label. Truncated at 480 chars for email clients. */
  reasoning?: string | null;

  /** Proposal expiry — shown in the CTA footer copy. */
  expiresAt?: Date | null;

  /** Destination of the Open button. Required. */
  hindsightUrl: string;
}

// ─── URL helpers ─────────────────────────────────────────────────────────────

/**
 * Absolute base URL for email links. Picks the first available signal:
 * NEXT_PUBLIC_APP_URL (set explicitly in prod), VERCEL_URL (auto-set on
 * Vercel deploys), or the production fallback.
 */
export function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (explicit) return explicit;
  const vercel = process.env.VERCEL_URL;
  if (vercel) return vercel.startsWith("http") ? vercel : `https://${vercel}`;
  return "https://hindsight.app";
}

export function tradeDetailUrl(positionId: string): string {
  return `${appBaseUrl()}/trades/${positionId}`;
}

export function tradesIndexUrl(): string {
  return `${appBaseUrl()}/trades`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

function fmtPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

function fmtMoney(n: number): string {
  return `$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtSignedMoney(n: number): string {
  const sign = n >= 0 ? "+" : "−";
  return `${sign}${fmtMoney(n)}`;
}

function fmtSignedPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateShort(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function hoursUntil(d: Date): number {
  return Math.max(1, Math.round((d.getTime() - Date.now()) / (60 * 60 * 1000)));
}

/** Bought/Shorted/Sold/Covered — past tense for executed, present for proposal. */
function verbForHeader(data: TradeCardData): string {
  const { action, tense, direction } = data;
  if (tense === "PROPOSAL") {
    if (action === "BUY") return direction === "LONG" ? "wants to buy" : "wants to short";
    return direction === "LONG" ? "wants to sell" : "wants to cover";
  }
  if (action === "BUY") return direction === "LONG" ? "bought" : "shorted";
  return direction === "LONG" ? "sold" : "covered";
}

// ─── Render ──────────────────────────────────────────────────────────────────

export function renderTradeCard(d: TradeCardData): string {
  const C = TRADE_CARD_COLORS;
  const isSell = d.action === "SELL";
  const isProposal = d.tense === "PROPOSAL";
  const isLive = d.environment === "LIVE";

  const verb = verbForHeader(d);
  const pnlPct = d.realizedPnlPct;
  const pnlColor =
    pnlPct == null ? C.textMuted : pnlPct >= 0 ? C.positive : C.negative;
  const pnlBg = pnlPct == null ? C.chipBg : pnlPct >= 0 ? C.positiveBg : C.negativeBg;

  const gainPhrase =
    isSell && pnlPct != null
      ? ` for <span style="color:${pnlColor};font-variant-numeric:tabular-nums;">${fmtSignedPct(pnlPct)}</span>`
      : "";

  // Stock-row right side: SELL shows entry → current; BUY shows current only.
  const currentPrice = d.currentPrice ?? (isSell ? d.exitPrice : d.entryPrice) ?? d.entryPrice;
  const rightSide = isSell
    ? `<span style="color:${C.textFaint};font-variant-numeric:tabular-nums;">${fmtPrice(d.entryPrice)} →</span> <span style="color:${C.textPrimary};font-weight:600;font-variant-numeric:tabular-nums;">${fmtPrice(currentPrice)}</span>`
    : `<span style="color:${C.textPrimary};font-weight:600;font-variant-numeric:tabular-nums;">${fmtPrice(currentPrice)}</span>`;

  // Stock-row left side: ticker + (sale) inline gain pill.
  const inlineGainPill =
    isSell && pnlPct != null
      ? `<span style="margin-left:10px;display:inline-block;padding:2px 8px;border-radius:999px;background:${pnlBg};color:${pnlColor};font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;">${fmtSignedPct(pnlPct)}</span>`
      : "";

  // Logo via Parqet — same source the in-app StockLogo uses.
  const logoUrl = `https://assets.parqet.com/logos/symbol/${encodeURIComponent(d.ticker)}`;

  // ── Header status badges ───────────────────────────────────────────────────
  const envBadge = isLive
    ? `<span style="display:inline-block;padding:3px 9px;border-radius:6px;background:${C.liveBg};color:${C.liveText};font-size:11px;font-weight:600;letter-spacing:0.04em;">LIVE</span>`
    : `<span style="display:inline-block;padding:3px 9px;border-radius:6px;background:${C.chipBg};color:${C.chipText};font-size:11px;font-weight:600;letter-spacing:0.04em;">PAPER</span>`;
  const proposalBadge = isProposal
    ? `<span style="display:inline-block;padding:3px 9px;border-radius:6px;background:${C.amberBg};color:${C.amber};border:1px solid ${C.amberBorder};font-size:11px;font-weight:600;letter-spacing:0.04em;">PROPOSED</span>`
    : "";

  // ── Key/value rows ─────────────────────────────────────────────────────────
  const estPrefix = isProposal ? "Est. " : "";

  const rows: Array<{ label: string; value: string; color?: string }> = [];
  rows.push({ label: "Direction", value: d.direction === "LONG" ? "Long" : "Short" });
  rows.push({ label: "Shares", value: d.qty.toLocaleString() });
  rows.push({
    label: isProposal ? "Est. entry" : "Entry",
    value: fmtPrice(d.entryPrice),
  });
  if (isSell) {
    rows.push({
      label: isProposal ? "Est. exit" : "Exit",
      value: d.exitPrice != null ? fmtPrice(d.exitPrice) : "—",
    });
  } else {
    rows.push({
      label: "Target",
      value: d.targetPrice != null ? fmtPrice(d.targetPrice) : "—",
    });
    if (d.stopLoss != null) {
      rows.push({ label: "Stop loss", value: fmtPrice(d.stopLoss), color: C.negative });
    }
  }
  rows.push({
    label: `${estPrefix}Market value`,
    value: fmtMoney(d.marketValue),
  });
  if (isSell && d.realizedPnl != null) {
    rows.push({
      label: isProposal ? "Est. P&L" : "Realized P&L",
      value: `${fmtSignedMoney(d.realizedPnl)}${pnlPct != null ? ` (${fmtSignedPct(pnlPct)})` : ""}`,
      color: pnlColor,
    });
  }

  // Dates row — single date for buy, opened → closed timeline for sell.
  let dateValue = "—";
  if (isSell && d.openedAt && d.closedAt) {
    dateValue = `${fmtDateShort(d.openedAt)} → ${fmtDateShort(d.closedAt)}`;
  } else if (isSell && d.closedAt) {
    dateValue = fmtDate(d.closedAt);
  } else if (d.openedAt) {
    dateValue = fmtDate(d.openedAt);
  }
  rows.push({ label: isSell ? "Dates" : "Date", value: dateValue });

  const rowsHtml = rows
    .map((r, i) => {
      const isLast = i === rows.length - 1;
      const border = isLast ? "" : `border-bottom:1px solid ${C.rowBorder};`;
      const valueColor = r.color ?? C.textPrimary;
      return `<tr>
        <td style="padding:8px 0;${border}font-size:13px;color:${C.textMuted};">${r.label}</td>
        <td style="padding:8px 0;${border}font-size:13px;font-weight:600;text-align:right;color:${valueColor};font-variant-numeric:tabular-nums;">${r.value}</td>
      </tr>`;
    })
    .join("");

  // ── Reasoning ──────────────────────────────────────────────────────────────
  const reasoningBlock = d.reasoning
    ? `<div style="margin:14px 0 0;padding:12px 14px;background:${C.logoBg};border:1px solid ${C.rowBorder};border-radius:8px;">
        <p style="margin:0 0 4px;font-size:10px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${C.textFaint};">Reasoning</p>
        <p style="margin:0;font-size:13px;line-height:1.55;color:${C.textPrimary};">${escapeHtml(truncate(d.reasoning, 480))}</p>
      </div>`
    : "";

  // ── CTA banner ─────────────────────────────────────────────────────────────
  const ctaCopy = isProposal
    ? `Open Hindsight to approve or reject this proposal${
        d.expiresAt
          ? `. Expires in ${hoursUntil(d.expiresAt)}h.`
          : "."
      }`
    : isSell
      ? "Open Hindsight to review the closed position."
      : "Open Hindsight to review the new position.";

  const ctaButtonLabel = isProposal ? "Review" : "Open";

  const ctaBlock = `<div style="margin:18px 0 0;padding:12px 14px;background:${C.logoBg};border:1px solid ${C.cardBorder};border-radius:10px;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="font-size:13px;color:${C.textMuted};">${ctaCopy}</td>
        <td style="text-align:right;white-space:nowrap;">
          <a href="${escapeHtml(d.hindsightUrl)}" style="display:inline-block;padding:6px 14px;background:${C.textPrimary};color:${C.pageBg};font-size:13px;font-weight:600;text-decoration:none;border-radius:8px;">${ctaButtonLabel}</a>
        </td>
      </tr>
    </table>
  </div>`;

  // ── Compose ────────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:${C.pageBg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${C.textPrimary};">
  <div style="max-width:560px;margin:0 auto;padding:32px 20px;">

    <!-- Header -->
    <div style="margin-bottom:18px;">
      <div style="margin-bottom:10px;">
        ${envBadge}${proposalBadge ? ` ${proposalBadge}` : ""}
      </div>
      <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${C.textFaint};">Hindsight Agent</p>
      <h1 style="margin:8px 0 0;font-size:20px;font-weight:700;line-height:1.3;color:${C.textPrimary};letter-spacing:-0.01em;">
        ${escapeHtml(d.analystName)} ${escapeHtml(verb)} ${d.qty.toLocaleString()} shares of ${escapeHtml(d.ticker)}${gainPhrase}
      </h1>
    </div>

    <!-- Stock row -->
    <div style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:10px;padding:12px 14px;margin-bottom:10px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:0;width:36px;vertical-align:middle;">
            <img src="${logoUrl}" alt="" width="28" height="28" style="display:block;border-radius:6px;background:${C.logoBg};border:1px solid ${C.cardBorder};" />
          </td>
          <td style="padding:0 12px;vertical-align:middle;">
            <span style="font-size:14px;font-weight:700;color:${C.textPrimary};letter-spacing:0.01em;">${escapeHtml(d.ticker)}</span>${inlineGainPill}
            ${d.tickerName ? `<div style="margin-top:1px;font-size:11px;color:${C.textMuted};">${escapeHtml(d.tickerName)}</div>` : ""}
          </td>
          <td style="padding:0;vertical-align:middle;text-align:right;font-size:13px;">
            ${rightSide}
          </td>
        </tr>
      </table>
    </div>

    <!-- Stats card -->
    <div style="background:${C.cardBg};border:1px solid ${C.cardBorder};border-radius:10px;padding:8px 14px;">
      <table style="width:100%;border-collapse:collapse;">
        ${rowsHtml}
      </table>
      ${reasoningBlock}
    </div>

    ${ctaBlock}

    <!-- Footer -->
    <p style="margin:18px 0 0;font-size:12px;color:${C.textFaint};line-height:1.5;">
      Automated message from your Hindsight trading agent.${
        !isProposal
          ? ` Disable trade alerts per analyst on the analyst's settings page.`
          : ""
      }
    </p>
  </div>
</body>
</html>`;
}
