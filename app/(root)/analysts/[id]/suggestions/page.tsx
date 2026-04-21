import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { listSuggestionsForAnalyst } from "@/lib/actions/suggestion.actions";
import SuggestionsClient from "@/components/analysts/SuggestionsClient";

type Params = { id: string };

export default async function SuggestionsPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const userId = user?.id ?? "";

  if (!userId) notFound();

  const analyst = await prisma.agentConfig.findFirst({
    where: { id, userId },
    select: { id: true, name: true },
  });
  if (!analyst) notFound();

  const bucket = await listSuggestionsForAnalyst(id);

  return (
    <SuggestionsClient
      analystId={analyst.id}
      analystName={analyst.name}
      bucket={bucket}
    />
  );
}
