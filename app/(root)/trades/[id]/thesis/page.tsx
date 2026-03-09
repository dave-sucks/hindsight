import { notFound, redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';

/**
 * /trades/[id]/thesis — redirect to the canonical thesis detail page.
 * The trade's thesis lives at /research/[thesisId].
 */
export default async function TradeThesisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const trade = await prisma.trade.findUnique({
    where: { id },
    select: { userId: true, thesisId: true },
  });

  if (!trade || trade.userId !== user?.id) notFound();

  // The canonical thesis detail is at /research/[thesisId]
  redirect(`/research/${trade.thesisId}`);
}
