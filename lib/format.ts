// ── Centralized formatting helpers ────────────────────────────────────────────
// Use these everywhere instead of inline toLocaleString / Intl.NumberFormat.

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$1,234.56" */
export function formatCurrency(value: number): string {
  return USD.format(value);
}

/** "+$1,234.56" or "-$1,234.56" */
export function formatSignedCurrency(value: number): string {
  const abs = USD.format(Math.abs(value));
  return value >= 0 ? `+${abs}` : `-${abs}`;
}

/** "Mar 14" from "2024-03-14", or "2:30 PM" from "2024-03-14T14:30" */
export function formatDateLabel(d: string): string {
  if (d.includes("T")) {
    const dt = new Date(d);
    return dt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  if (d.length === 10 && d.includes("-")) {
    const dt = new Date(d + "T12:00:00");
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  return d;
}
