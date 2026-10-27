/** GET the research brief attached to one of your orders — the proposal card polls this until it lands. */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { briefForOrderView } from "@/lib/research/brief-read";

export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const order = await prisma.order.findFirst({
    where: { id: orderId, position: { accountId } },
    select: { id: true },
  });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ brief: await briefForOrderView(orderId) }, { headers: { "Cache-Control": "no-store" } });
}
