import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChatPageClient } from "./ChatPageClient";

/**
 * Principal chat — operator-perspective chat at /chat.
 *
 * No DB work here. Principal chat is NOT a ResearchRun and intentionally
 * doesn't have one. The route at /api/agent/principal runs without a
 * runId; reads work directly, and writes that require run-attribution
 * (place_trade etc.) fail cleanly with a message directing the user to
 * the analyst page.
 */
export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  return <ChatPageClient />;
}
