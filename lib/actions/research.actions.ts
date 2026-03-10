"use server";

import { prisma } from "@/lib/prisma";
import { persistThesesAndTrades, type ThesisOutput } from "@/lib/actions/run-persistence";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "";
const PYTHON_SERVICE_SECRET = process.env.PYTHON_SERVICE_SECRET ?? "";

type RunResponse = {
  run_id: string;
  theses: ThesisOutput[];
  tickers_researched: number;
  tickers_passed: number;
  total_tokens: number;
  duration_seconds: number;
  source: "AGENT" | "MANUAL";
};

export async function triggerResearchRun(
  userId: string,
  tickers: string[],
  source: "AGENT" | "MANUAL" = "AGENT",
  agentConfigId?: string
): Promise<{ thesisIds: string[]; tradeIds: string[]; error?: string }> {
  if (!PYTHON_SERVICE_URL) {
    return { thesisIds: [], tradeIds: [], error: "PYTHON_SERVICE_URL not configured" };
  }

  // Load agent config for this user (prefer specific agentConfigId if provided)
  const agentConfig = await prisma.agentConfig
    .findFirst({
      where: agentConfigId
        ? { id: agentConfigId, userId }
        : { userId, enabled: true },
    })
    .catch(() => null);

  const agentConfigPayload = agentConfig ?? {
    minConfidence: 70,
    directionBias: "BOTH",
    holdDurations: ["SWING"],
    maxOpenPositions: 5,
    maxPositionSize: 500,
  };

  // Call Python service
  let data: RunResponse;
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/research/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Secret": PYTHON_SERVICE_SECRET,
      },
      body: JSON.stringify({ tickers, source, agent_config: agentConfigPayload }),
      signal: AbortSignal.timeout(120_000), // 2 min total budget
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        thesisIds: [],
        tradeIds: [],
        error: `Python service error ${res.status}: ${text}`,
      };
    }
    data = (await res.json()) as RunResponse;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { thesisIds: [], tradeIds: [], error: `Network error: ${message}` };
  }

  const minConfidence = (agentConfig?.minConfidence ?? 70) as number;

  // Create one ResearchRun for the whole batch
  const researchRun = await prisma.researchRun.create({
    data: {
      userId,
      source,
      status: "COMPLETE",
      parameters: agentConfigPayload as object,
      completedAt: new Date(),
      ...(agentConfigId ? { agentConfigId } : agentConfig ? { agentConfigId: agentConfig.id } : {}),
    },
  });

  const { thesisIds, tradeIds } = await persistThesesAndTrades(
    researchRun.id,
    userId,
    data.theses,
    minConfidence,
    agentConfig,
    true, // autoTrade: AGENT runs always auto-trade
  );

  return { thesisIds, tradeIds };
}
