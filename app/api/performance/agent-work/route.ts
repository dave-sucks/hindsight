import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { RANGES, loadAgentWork, type RangeDays } from "@/lib/performance/agent-work";

export const dynamic = "force-dynamic";

/** The Agent work tab's numbers: ?days=7|30|90 (default 30), ?analyst=<id> (default all). Read-only. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const asked = Number(req.nextUrl.searchParams.get("days"));
  const days: RangeDays = (RANGES as readonly number[]).includes(asked) ? (asked as RangeDays) : 30;
  const analystId = req.nextUrl.searchParams.get("analyst") || null;
  try {
    return NextResponse.json(await loadAgentWork({ accountId, days, analystId }));
  } catch (err) {
    console.error("[agent-work] load failed:", err);
    return NextResponse.json({ error: "Couldn't load the agent work numbers." }, { status: 500 });
  }
}
