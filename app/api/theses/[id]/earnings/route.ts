/**
 * GET /api/theses/:id/earnings
 *
 * The earnings layer for a thesis: the next scheduled report and the last
 * few reported quarters, read live from the vendor when the sheet opens —
 * the same way the price header is a live quote, not a stored price.
 *
 * Nothing here is persisted, on purpose. The calendar is the vendor's; a
 * local copy is a second one that goes stale (the thesis writer's prose
 * "latest earnings" section is exactly that, and it reads as current when
 * it is weeks old). What the system DID about a report — a fired trigger
 * with the figures, a review, a trade — is on the activity log already.
 * See docs/plans/MARKET_DATA.md §2.
 *
 * Two Finnhub calls through the shared client (5-minute cache, throttle,
 * retries). Scoped to the requesting user. Fails soft: a vendor miss
 * returns nulls, never a 500 — the sheet paints without this block.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { finnhub } from "@/lib/agent/research-helpers";
import { surprisePct } from "@/lib/agent/triggers/earnings";
import type { EarningsResponse } from "@/lib/types/thesis-sheet";

/** How far forward to look for the next report. Two quarters is plenty. */
const LOOKAHEAD_DAYS = 180;
const RECENT_QUARTERS = 8;

interface CalendarRow {
  date?: string;
  hour?: string | null;
  epsEstimate?: number | null;
  epsActual?: number | null;
  revenueEstimate?: number | null;
}

interface HistoryRow {
  period?: string;
  actual?: number | null;
  estimate?: number | null;
  surprisePercent?: number | null;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const thesis = await prisma.thesis.findFirst({
    where: { id, accountId },
    select: { ticker: true },
  });
  if (!thesis) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ticker = thesis.ticker.toUpperCase();
  const now = new Date();
  const from = isoDay(now);
  const to = isoDay(new Date(now.getTime() + LOOKAHEAD_DAYS * 86_400_000));

  const [calendar, history] = await Promise.all([
    finnhub(`/calendar/earnings?symbol=${ticker}&from=${from}&to=${to}`, 1),
    finnhub(`/stock/earnings?symbol=${ticker}&limit=${RECENT_QUARTERS}`, 1),
  ]);

  // Next: the earliest scheduled row that hasn't reported. A row dated
  // today with no actual is tonight's (or this morning's, already past)
  // report — still "next" until the actual lands.
  const rows = ((calendar.data as { earningsCalendar?: CalendarRow[] } | null)
    ?.earningsCalendar ?? [])
    .filter((r) => r.date && r.epsActual == null && r.date >= from)
    .sort((a, b) => (a.date as string).localeCompare(b.date as string));
  const nextRow = rows[0];
  const next: EarningsResponse["next"] = nextRow
    ? {
        date: nextRow.date as string,
        hour: nextRow.hour ?? null,
        epsEstimate: nextRow.epsEstimate ?? null,
        revenueEstimate: nextRow.revenueEstimate ?? null,
      }
    : null;

  // Recent: Finnhub's own surprisePercent when present, else our arithmetic
  // (identical formula — verified on NVDA 2026-08-26, 3.8159 both ways).
  const recent: EarningsResponse["recent"] = (
    Array.isArray(history.data) ? (history.data as HistoryRow[]) : []
  )
    .filter((r) => r.period)
    .map((r) => ({
      period: r.period as string,
      actual: r.actual ?? null,
      estimate: r.estimate ?? null,
      surprisePct:
        typeof r.surprisePercent === "number"
          ? r.surprisePercent
          : r.actual != null
            ? surprisePct(r.actual, r.estimate)
            : null,
    }));

  const body: EarningsResponse = { next, recent };
  return NextResponse.json(body);
}
