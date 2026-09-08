"use server";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";

// ─── Pinned tickers ──────────────────────────────────────────────────────────
//
// The dashboard right rail used to be a stock list; it's now proposals-only,
// and the full book lives in the coverage table under the chart. Pins put a
// hand-picked subset back on the rail.
//
// The pinned unit is the TICKER, deliberately. A thesis is an episode of
// belief and a position is an episode of money — both end. Attention doesn't:
// you want to keep watching the name after you sell it, and you wanted to
// watch it before you ever bought. Only the ticker survives every transition,
// so it's the only thing a pin can hang on without dying under you.
//
// Consequence: this module stores nothing but the pin. What a pinned row SAYS
// (held / watching / passed / uncovered) is resolved at render time from
// coverage data — see the resolver in components/dashboard/PinnedPanel.

/** Ceiling on pins. The rail is a shortlist, not a second portfolio view.
 *  Not exported — a "use server" module may only export async functions. */
const MAX_PINNED = 12;

async function currentAccountId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return getAccountId(user.id);
}

/** Pinned tickers for the current account, in display order. */
export async function getPinnedTickers(): Promise<string[]> {
  const accountId = await currentAccountId();
  if (!accountId) return [];

  const rows = await prisma.pinnedTicker.findMany({
    where: { accountId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { ticker: true },
  });
  return rows.map((r) => r.ticker);
}

export interface SetPinnedResult {
  ok: boolean;
  pinned: boolean;
  /** Set when the write was refused (not signed in / at the cap). */
  error?: string;
}

/**
 * Pin or unpin a ticker. Idempotent in both directions — pinning an
 * already-pinned name is a no-op, not an error, so a double-click from two
 * surfaces can't 500.
 */
export async function setPinnedTicker(
  ticker: string,
  pinned: boolean,
): Promise<SetPinnedResult> {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) return { ok: false, pinned: false, error: "Missing ticker" };

  const accountId = await currentAccountId();
  if (!accountId) return { ok: false, pinned: !pinned, error: "Not signed in" };

  if (pinned) {
    const existing = await prisma.pinnedTicker.findUnique({
      where: { accountId_ticker: { accountId, ticker: symbol } },
      select: { id: true },
    });
    if (!existing) {
      const count = await prisma.pinnedTicker.count({ where: { accountId } });
      if (count >= MAX_PINNED) {
        return {
          ok: false,
          pinned: false,
          error: `Pin limit reached (${MAX_PINNED}). Unpin something first.`,
        };
      }
      await prisma.pinnedTicker.create({ data: { accountId, ticker: symbol } });
    }
  } else {
    await prisma.pinnedTicker.deleteMany({ where: { accountId, ticker: symbol } });
  }

  // No revalidatePath here. Both surfaces that read pins ("/" and
  // /stocks/[symbol]) are dynamic — they call cookies() through the (root)
  // layout — so there is no cache entry to invalidate. All the call did was
  // force a full dashboard re-render (Alpaca + Finnhub + coverage) before this
  // promise resolved, which is most of what made pinning feel slow. The rail
  // updates itself from the shared client cache (hooks/usePinned), and the
  // server list in app/(root)/page.tsx is only the pre-hydration fallback,
  // re-read on the next real page load.
  return { ok: true, pinned };
}
