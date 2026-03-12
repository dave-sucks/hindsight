import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/research/agent-run
 * Creates a ResearchRun row and returns its ID.
 * The actual research happens via the LLM agent on the run page.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { agentConfigId } = (await req.json()) as {
    agentConfigId?: string;
  };

  // Load agent config if provided
  const agentConfig = agentConfigId
    ? await prisma.agentConfig
        .findFirst({ where: { id: agentConfigId, userId: user.id } })
        .catch(() => null)
    : null;

  const run = await prisma.researchRun.create({
    data: {
      userId: user.id,
      source: "MANUAL",
      status: "RUNNING",
      parameters: agentConfig
        ? ({
            analystName: agentConfig.name,
            agentMode: true,
          } as object)
        : ({ agentMode: true } as object),
      ...(agentConfig ? { agentConfigId: agentConfig.id } : {}),
    },
  });

  return Response.json({ runId: run.id });
}
