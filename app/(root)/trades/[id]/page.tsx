import { notFound, redirect } from "next/navigation";
import { getAccountId } from "@/lib/auth/account";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

/**
 * /trades/[id] — a trade is its thesis, so this lands on /theses/[id]: the
 * thesis the buy decision links to, or the analyst's thesis on the ticker
 * for rows written before decisions carried one.
 */
export default async function TradeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const accountId = user ? await getAccountId(user.id) : null;

  const position = await prisma.position.findUnique({
    where: { id },
    select: {
      accountId: true,
      symbol: true,
      analystId: true,
      decisions: { take: 1, select: { thesisId: true }, where: { thesisId: { not: null } } },
    },
  });
  if (!position || !accountId || position.accountId !== accountId) notFound();

  const thesisId =
    position.decisions[0]?.thesisId ??
    (
      await prisma.thesis.findFirst({
        where: { accountId, ticker: position.symbol, researchRun: { agentConfigId: position.analystId } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      })
    )?.id;
  if (!thesisId) notFound();
  redirect(`/theses/${thesisId}`);
}
