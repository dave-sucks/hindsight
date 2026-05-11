// ─── Daily Run Digest email template ─────────────────────────────────────────
// One email per owner at 10 AM ET on weekdays. Consolidates everything the
// owner's analysts did this morning: new positions, closed positions, and
// material thesis changes. Analysts with no activity collapse to a single
// "No actions taken this morning" line so the owner can scan the morning
// at a glance without opening the app.

export interface DigestNewTrade {
  ticker: string;
  direction: "LONG" | "SHORT";
  qty: number;
  avgCost: number;
  stopLoss: number | null;
  targetPrice: number | null;
}

export interface DigestClosedTrade {
  ticker: string;
  direction: "LONG" | "SHORT";
  outcome: "WIN" | "LOSS" | "BREAKEVEN";
  realizedPnlPct: number;
  daysHeld: number;
  closeReason: string;
}

export interface DigestThesisChange {
  ticker: string;
  /** ThesisUpdate.type — UPDATED | INVALIDATED | CLOSED (REVIEWED is filtered upstream). */
  type: string;
  summary: string;
}

export interface DigestAnalyst {
  analystName: string;
  newTrades: DigestNewTrade[];
  closedTrades: DigestClosedTrade[];
  thesisChanges: DigestThesisChange[];
}

export interface DailyRunDigestData {
  /** "Monday, May 11" (already formatted in ET). */
  date: string;
  analysts: DigestAnalyst[];
}

const CLOSE_REASON_LABELS: Record<string, string> = {
  TARGET: "target hit",
  STOP: "stop hit",
  TIME: "time exit",
  MANUAL: "manual close",
};

const THESIS_CHANGE_LABELS: Record<string, { emoji: string; label: string; color: string }> = {
  INVALIDATED: { emoji: "🔴", label: "INVALIDATED", color: "#ff6d87" },
  CLOSED: { emoji: "⚪", label: "CLOSED", color: "#9ca3af" },
  UPDATED: { emoji: "🟡", label: "UPDATED", color: "#f59e0b" },
};

export function dailyRunDigestHtml(d: DailyRunDigestData): string {
  const sections = d.analysts.map(renderAnalystSection).join("");

  // Account-level rollup for the header subtitle.
  const totalNew = d.analysts.reduce((s, a) => s + a.newTrades.length, 0);
  const totalClosed = d.analysts.reduce((s, a) => s + a.closedTrades.length, 0);
  const totalThesisChanges = d.analysts.reduce(
    (s, a) => s + a.thesisChanges.length,
    0,
  );
  const summaryLine =
    totalNew + totalClosed + totalThesisChanges === 0
      ? "No actions taken this morning."
      : [
          totalNew > 0 ? `${totalNew} new position${totalNew !== 1 ? "s" : ""}` : null,
          totalClosed > 0 ? `${totalClosed} closed` : null,
          totalThesisChanges > 0
            ? `${totalThesisChanges} thesis change${totalThesisChanges !== 1 ? "s" : ""}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#030712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f9fafb;">
  <div style="max-width:640px;margin:32px auto;padding:0 16px;">

    <!-- Header -->
    <div style="margin-bottom:24px;">
      <p style="margin:0;font-size:12px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">Hindsight Agent</p>
      <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;color:#f9fafb;">
        Morning Run Digest — ${escapeHtml(d.date)}
      </h1>
      <p style="margin:8px 0 0;font-size:13px;color:#9ca3af;">${escapeHtml(summaryLine)}</p>
    </div>

    ${sections}

    <!-- Footer -->
    <p style="margin:24px 0 0;font-size:12px;color:#6b7280;">
      This is an automated message from your Hindsight trading agent. You can disable trade alerts per analyst on the analyst's settings page.
    </p>
  </div>
</body>
</html>`;
}

function renderAnalystSection(a: DigestAnalyst): string {
  const noActivity =
    a.newTrades.length === 0 &&
    a.closedTrades.length === 0 &&
    a.thesisChanges.length === 0;

  const newBlock =
    a.newTrades.length > 0
      ? `
        <p style="margin:16px 0 8px;font-size:12px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;color:#9ca3af;">
          New positions (${a.newTrades.length})
        </p>
        ${a.newTrades.map(renderNewTrade).join("")}
      `
      : "";

  const closedBlock =
    a.closedTrades.length > 0
      ? `
        <p style="margin:16px 0 8px;font-size:12px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;color:#9ca3af;">
          Closed positions (${a.closedTrades.length})
        </p>
        ${a.closedTrades.map(renderClosedTrade).join("")}
      `
      : "";

  const thesisBlock =
    a.thesisChanges.length > 0
      ? `
        <p style="margin:16px 0 8px;font-size:12px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;color:#9ca3af;">
          Thesis changes (${a.thesisChanges.length})
        </p>
        ${a.thesisChanges.map(renderThesisChange).join("")}
      `
      : "";

  const body = noActivity
    ? `<p style="margin:8px 0 0;font-size:13px;color:#6b7280;font-style:italic;">No actions taken this morning.</p>`
    : `${newBlock}${closedBlock}${thesisBlock}`;

  return `
    <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:20px;margin-bottom:16px;">
      <h2 style="margin:0;font-size:16px;font-weight:600;color:#f9fafb;">${escapeHtml(a.analystName)}</h2>
      ${body}
    </div>
  `;
}

function renderNewTrade(t: DigestNewTrade): string {
  const emoji = t.direction === "LONG" ? "📈" : "📉";
  const stop = t.stopLoss != null ? `stop $${t.stopLoss.toFixed(2)}` : "stop —";
  const target =
    t.targetPrice != null ? `target $${t.targetPrice.toFixed(2)}` : "target —";
  return `
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;font-size:13px;color:#f9fafb;border-bottom:1px solid #1f2937;">
      <span style="font-weight:600;">${emoji} ${escapeHtml(t.ticker)}</span>
      <span style="font-variant-numeric:tabular-nums;color:#9ca3af;">
        ${t.qty.toLocaleString()} @ $${t.avgCost.toFixed(2)} · ${stop} · ${target}
      </span>
    </div>
  `;
}

function renderClosedTrade(t: DigestClosedTrade): string {
  const isWin = t.outcome === "WIN";
  const isBreakeven = t.outcome === "BREAKEVEN";
  const emoji = isWin ? "✅" : isBreakeven ? "↔️" : "⛔";
  const pnlColor = isWin ? "#51b857" : isBreakeven ? "#f59e0b" : "#ff6d87";
  const sign = t.realizedPnlPct >= 0 ? "+" : "";
  const reasonLabel = CLOSE_REASON_LABELS[t.closeReason] ?? t.closeReason.toLowerCase();
  return `
    <div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;font-size:13px;color:#f9fafb;border-bottom:1px solid #1f2937;">
      <span style="font-weight:600;">${emoji} ${escapeHtml(t.ticker)} <span style="color:${pnlColor};font-weight:700;font-variant-numeric:tabular-nums;">${sign}${t.realizedPnlPct.toFixed(1)}%</span></span>
      <span style="font-variant-numeric:tabular-nums;color:#9ca3af;">
        ${t.outcome} · held ${t.daysHeld}d · ${escapeHtml(reasonLabel)}
      </span>
    </div>
  `;
}

function renderThesisChange(c: DigestThesisChange): string {
  const meta = THESIS_CHANGE_LABELS[c.type] ?? {
    emoji: "🔵",
    label: c.type,
    color: "#60a5fa",
  };
  return `
    <div style="padding:6px 0;font-size:13px;color:#f9fafb;border-bottom:1px solid #1f2937;">
      <span style="font-weight:600;">${meta.emoji} ${escapeHtml(c.ticker)}</span>
      <span style="color:${meta.color};font-weight:600;margin-left:6px;">${meta.label}</span>
      <span style="color:#9ca3af;"> — ${escapeHtml(truncate(c.summary, 160))}</span>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
