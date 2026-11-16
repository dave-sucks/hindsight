import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadChatRequests } from "@/lib/actions/chat.actions";

/**
 * GET /api/chat/requests?runId=<id> | ?session=<chatSessionId>
 *
 * What a principal chat sent the model, for the page's Context panel to read again after a message
 * (hooks/useLiveRequests.ts). Same contract as /api/chat/thread: a resumed chat knows its runId, a
 * fresh one only the session id it sent. Only the signed-in user's own chat is read.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const requests = await loadChatRequests({ runId: params.get("runId"), session: params.get("session") }, user.id);
  return NextResponse.json({ requests }, { headers: { "Cache-Control": "no-store" } });
}
