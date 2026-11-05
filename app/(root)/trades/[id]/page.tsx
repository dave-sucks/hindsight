import { notFound } from 'next/navigation';
import { ThesisHeader } from '@/components/domain/thesis-header';
import { ThesisPageBody } from '@/components/trades/ThesisPageBody';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { getAccountId } from '@/lib/auth/account';
import { thesisSheetStateSelect } from '@/lib/agent/thesis-sheet-state';
import { agentWatchDays } from '@/lib/agent/triggers/agent-watch';
import { getStockInfo } from '@/lib/actions/stock-info';

// ─── Page ────────────────────────────────────────────────────────────────────
// The trade's page: the thesis's header and body, pinned to this position.
// The position card sits under the price; its facts (shares, cost, the
// dates, the exit) open from the Transactions tab's row. The Trade Details
// card that pinned them beside every tab was deleted 2026-11-04.

export default async function TradeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const accountId = user ? await getAccountId(user.id) : null;

  const position = await prisma.position.findUnique({
    where: { id },
    include: {
      analyst: { select: { id: true, name: true } },
      decisions: {
        take: 1,
        include: {
          thesis: {
            select: {
              ...thesisSheetStateSelect,
              conviction: true,
              createdAt: true,
              researchRun: { select: { id: true, agentConfigId: true } },
            },
          },
        },
      },
    },
  });

  if (!position || !accountId || position.accountId !== accountId) notFound();

  // The HEADER reads identity so the name + normalized exchange match the
  // thesis sheet exactly (same cache, same normalizer). The price, the
  // position's P&L and the levels are the body's: it loads them the way the
  // sheet does, pinned to this position.
  const identity = await getStockInfo(position.symbol);
  const thesis = position.decisions[0]?.thesis ?? null;
  const isOpen = position.status === 'OPEN';
  // Three states, not two: PENDING_APPROVAL is a proposal, not a closed trade.
  const isProposal = position.status === 'PENDING_APPROVAL';
  const isClosed = !isOpen && !isProposal;

  return (
    <div data-surface="paper">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* ── Header — the thesis's, the same one the sheet renders ─────── */}
      <div className="mb-3">
        <ThesisHeader
          ticker={position.symbol}
          status={thesis?.status ?? (isClosed ? 'RETIRED' : 'HOLDING')}
          agentWatchDays={agentWatchDays(thesis?.triggers)}
          conviction={(thesis?.conviction ?? null) as 'STRONG' | 'HIGH' | 'MEDIUM' | 'LOW' | null}
          analystId={position.analyst?.id ?? null}
          thesisId={thesis?.id}
          closeTrade={isOpen ? { tradeId: position.id } : null}
        />
      </div>

      {/* The body carries the stock cards beside its tab panels, so they start level with the chart; pinned to this position, its fills come with the thesis. */}
      <ThesisPageBody thesisId={thesis?.id ?? null} positionId={position.id} ticker={position.symbol} displayName={identity.companyName ?? position.symbol} />
    </div>
    </div>
  );
}
