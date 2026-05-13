import { NextResponse, NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { inngest } from "@/lib/inngest/client";
import { getAccountId, getUserRole } from "@/lib/auth/account";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const role = await getUserRole(user.id, accountId);
  if (role === "VIEWER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Optional: filter to a specific analyst
  const body = await req.json().catch(() => ({})) as { agentConfigId?: string };
  const agentConfigId = body.agentConfigId ?? null;

  await inngest.send({
    name: "app/research.run.manual",
    data: {
      userId: user.id,
      accountId,
      ...(agentConfigId ? { agentConfigId } : {}),
    },
  });

  return NextResponse.json({ ok: true });
}
