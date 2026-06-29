import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { ThesisIngestForm } from "./ThesisIngestForm";

export const dynamic = "force-dynamic";

export default async function ThesisIngestPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const analysts = user
    ? await prisma.agentConfig.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, tradingEnvironment: true },
        orderBy: { name: "asc" },
      })
    : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Ingest thesis</h1>
        <p className="text-sm text-muted-foreground">
          Research a name in any Claude or GPT chat, then paste the JSON here to
          mint a WATCHING thesis. No model cost — this validates the input
          (taxonomy, triggers, gates) and saves it the same way the agent does.
        </p>
      </div>
      <ThesisIngestForm analysts={analysts} />
    </div>
  );
}
