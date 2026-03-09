// ─── Trade Placed email template ─────────────────────────────────────────────

export interface TradePlacedData {
  ticker: string;
  direction: "LONG" | "SHORT";
  entryPrice: number;
  shares: number;
  targetPrice?: number | null;
  stopLoss?: number | null;
  signalTypes?: string[];
  confidenceScore?: number;
  reasoningSummary?: string;
  tradeId: string;
}

export function tradePlacedHtml(d: TradePlacedData): string {
  const dir = d.direction === "LONG" ? "📈 Long" : "📉 Short";
  const positionValue = (d.entryPrice * d.shares).toFixed(2);
  const targetPct =
    d.targetPrice && d.direction === "LONG"
      ? (((d.targetPrice - d.entryPrice) / d.entryPrice) * 100).toFixed(1)
      : d.targetPrice && d.direction === "SHORT"
        ? (((d.entryPrice - d.targetPrice) / d.entryPrice) * 100).toFixed(1)
        : null;
  const stopPct =
    d.stopLoss && d.direction === "LONG"
      ? (((d.entryPrice - d.stopLoss) / d.entryPrice) * 100).toFixed(1)
      : d.stopLoss && d.direction === "SHORT"
        ? (((d.stopLoss - d.entryPrice) / d.entryPrice) * 100).toFixed(1)
        : null;

  const signals = d.signalTypes?.length
    ? d.signalTypes.map((s) => s.replace(/_/g, " ")).join(", ")
    : "N/A";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#030712;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f9fafb;">
  <div style="max-width:560px;margin:32px auto;padding:0 16px;">

    <!-- Header -->
    <div style="margin-bottom:24px;">
      <p style="margin:0;font-size:12px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">Hindsight Agent</p>
      <h1 style="margin:8px 0 0;font-size:22px;font-weight:600;color:#f9fafb;">
        ${dir} ${d.ticker} — Trade Placed
      </h1>
    </div>

    <!-- Stats card -->
    <div style="background:#111827;border:1px solid #1f2937;border-radius:8px;padding:20px;margin-bottom:16px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;">Entry price</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:#f9fafb;font-variant-numeric:tabular-nums;">$${d.entryPrice.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;">Shares</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:#f9fafb;font-variant-numeric:tabular-nums;">${d.shares}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;">Position value</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:#f9fafb;font-variant-numeric:tabular-nums;">$${positionValue}</td>
        </tr>
        ${
          d.targetPrice
            ? `<tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;">Target price</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:#10b981;font-variant-numeric:tabular-nums;">$${d.targetPrice.toFixed(2)}${targetPct ? ` (+${targetPct}%)` : ""}</td>
        </tr>`
            : ""
        }
        ${
          d.stopLoss
            ? `<tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;">Stop loss</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:#ef4444;font-variant-numeric:tabular-nums;">$${d.stopLoss.toFixed(2)}${stopPct ? ` (-${stopPct}%)` : ""}</td>
        </tr>`
            : ""
        }
        <tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;">Signals</td>
          <td style="padding:6px 0;font-size:13px;text-align:right;color:#f9fafb;">${signals}</td>
        </tr>
        ${
          d.confidenceScore != null
            ? `<tr>
          <td style="padding:6px 0;font-size:13px;color:#6b7280;">Confidence</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;text-align:right;color:#f9fafb;font-variant-numeric:tabular-nums;">${d.confidenceScore}%</td>
        </tr>`
            : ""
        }
      </table>
    </div>

    ${
      d.reasoningSummary
        ? `<!-- Thesis -->
    <div style="background:#111827;border:1px solid #1f2937;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;padding:16px;margin-bottom:16px;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;color:#6b7280;">Agent thesis</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#d1d5db;">${d.reasoningSummary}</p>
    </div>`
        : ""
    }

    <!-- Footer -->
    <p style="margin:16px 0 0;font-size:12px;color:#6b7280;">
      This is an automated message from your Hindsight trading agent.
      Trade alerts are sent for informational purposes only.
    </p>
  </div>
</body>
</html>`;
}
