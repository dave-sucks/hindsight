import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { findChatRunIdBySession, loadChatThread } from "@/lib/actions/chat.actions";
import { convertPersistedToUIMessages } from "@/lib/agent/convert-messages";

/**
 * GET /api/chat/thread?runId=<id> | ?session=<chatSessionId>
 *
 * A principal chat's saved thread, for the page to reload after its
 * connection drops mid-answer (hooks/useSavedAnswerRecovery.ts). A resumed
 * chat knows its runId; a fresh one only knows the session id it sent.
 *
 * `savedAt` is when the thread was last written and `now` is the server's
 * clock, so the page can tell whether the save holds the answer it lost.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const session = params.get("session");
  const runId =
    params.get("runId") ??
    (session ? await findChatRunIdBySession(session, user.id) : null);
  const thread = runId ? await loadChatThread(runId, user.id) : null;

  let messages: ReturnType<typeof convertPersistedToUIMessages> = [];
  if (thread) {
    try {
      const raw = JSON.parse(thread.threadJson);
      if (Array.isArray(raw)) messages = convertPersistedToUIMessages(raw);
    } catch {
      // Malformed thread JSON — report nothing saved.
    }
  }

  return NextResponse.json(
    {
      savedAt: messages.length > 0 && thread ? thread.savedAt.getTime() : null,
      now: Date.now(),
      messages,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
