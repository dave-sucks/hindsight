import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { getCurrentEnvironment } from "@/lib/actions/environment.actions";
import { loadTrading, type TradingRange } from "@/lib/performance/trading";

export const dynamic = "force-dynamic";

/** The Trading tab's numbers on the book the app is set to: ?range=30|90|all (default 90), ?analyst=<id>. Read-only. */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const accountId = await getAccountId(user.id);
  if (!accountId) return NextResponse.json({ error: "No account" }, { status: 403 });

  const asked = req.nextUrl.searchParams.get("range");
  const range: TradingRange = asked === "30" || asked === "all" ? asked : "90";
  const analystId = req.nextUrl.searchParams.get("analyst") || null;
  try {
    return NextResponse.json(await loadTrading({ accountId, environment: await getCurrentEnvironment(), range, analystId }));
  } catch (err) {
    console.error("[trading] load failed:", err);
    return NextResponse.json({ error: "Couldn't load the trading numbers." }, { status: 500 });
  }
}
