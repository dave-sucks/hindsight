/**
 * token-usage.ts — one way to count and record what a run read and wrote.
 *
 * Until 2026-10-02 only the morning run kept its token use
 * (`parameters.tokenUsage`); the trigger run, chat, the writer and
 * discovery threw theirs away, so nothing could say what an agent cost or
 * whether the provider's cache was working for it. Every agent now adds
 * each model request here and records the sum on its run row in the same
 * shape the morning run already used, so the existing readers keep working.
 */

import { prisma } from "@/lib/prisma";

/** Token use of one run, summed over every model request it made. */
export interface TokenUsage {
  input: number;
  /** The part of `input` the provider read from its cache. */
  cachedInput: number;
  output: number;
  total: number;
  requests: number;
}

/** The fields of the AI SDK's usage object this reads. */
export interface ReportedUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  totalTokens?: number | undefined;
  /** Older SDK name for the cached count; still filled in by some providers. */
  cachedInputTokens?: number | undefined;
  inputTokenDetails?: { cacheReadTokens?: number | undefined } | undefined;
}

export function emptyTokenUsage(): TokenUsage {
  return { input: 0, cachedInput: 0, output: 0, total: 0, requests: 0 };
}

/**
 * Add what one model request (or a whole call's aggregate, with `requests`
 * set to its step count) reported. A field the provider left out counts as
 * zero. Mutates and returns `acc` so it can sit inside an `onStepFinish`.
 */
export function addTokenUsage(
  acc: TokenUsage,
  usage: ReportedUsage | null | undefined,
  requests = 1,
): TokenUsage {
  if (!usage) return acc;
  acc.input += usage.inputTokens ?? 0;
  acc.cachedInput += usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? 0;
  acc.output += usage.outputTokens ?? 0;
  acc.total += usage.totalTokens ?? 0;
  acc.requests += requests;
  return acc;
}

/**
 * Write a run's token use onto its row, added to whatever is already there
 * (a chat run spans many turns, each its own request). Best effort: a
 * failure is logged and never thrown, so accounting can't fail a run.
 */
export async function recordTokenUsage(
  runId: string,
  usage: TokenUsage,
  model: string,
): Promise<void> {
  if (usage.requests === 0) return;
  try {
    const fresh = await prisma.researchRun.findUnique({
      where: { id: runId },
      select: { parameters: true },
    });
    const parameters =
      fresh?.parameters && typeof fresh.parameters === "object"
        ? (fresh.parameters as Record<string, unknown>)
        : {};
    const prev = (parameters.tokenUsage ?? {}) as Partial<TokenUsage>;
    const tokenUsage = {
      input: (prev.input ?? 0) + usage.input,
      cachedInput: (prev.cachedInput ?? 0) + usage.cachedInput,
      output: (prev.output ?? 0) + usage.output,
      total: (prev.total ?? 0) + usage.total,
      requests: (prev.requests ?? 0) + usage.requests,
      model,
    };
    await prisma.researchRun.update({
      where: { id: runId },
      data: { parameters: { ...parameters, tokenUsage } as object },
    });
  } catch (err) {
    console.error(`[token-usage] run=${runId} token use not recorded:`, err);
  }
}
