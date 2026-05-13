import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { ChatPageClient } from "./ChatPageClient";

/**
 * Principal chat — operator co-pilot.
 *
 * Server side just loads the analyst list for the scope picker.
 * Scope itself is set client-side (see ChatPageClient) — Notion/Linear
 * style chip in the input header, persisted in localStorage. NO URL
 * param: scope is part of the chat experience, not the route.
 */
export default async function ChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const analysts = await prisma.agentConfig.findMany({
    where: { userId: user.id },
    select: { id: true, name: true, enabled: true },
    orderBy: { createdAt: "asc" },
  });

  return <ChatPageClient analysts={analysts} />;
}
