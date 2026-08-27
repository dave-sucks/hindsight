/**
 * Recover "which tickers has this run already researched" from the run's
 * persisted messages.
 *
 * Why this exists: `createResearchTools` builds its in-run tool-call
 * tracker fresh on every call, and that call happens once per HTTP request.
 * A cron run is a single request, so `record_thesis`'s researched-before-
 * thesis gate behaved. A chat is one request PER TURN, so the tracker
 * resets between turns while the conversation — and the run — continues.
 *
 * What that cost (2026-08-25, Catalyst): turn 1 researched 13 tickers and
 * wrote 7 theses. Turn 2 opened with an empty tracker, so all 13
 * record_thesis calls were rejected as un-researched; the agent re-ran 13
 * get_stock_data calls, retried, and the batch landed a second time. Seven
 * tickers ended up with two PASSED theses each.
 *
 * The gate is right — a thesis on a ticker nobody looked at is not a
 * thesis. What was missing was the input. This supplies it.
 */

/** Tool calls that count as "we pulled live data on this name." */
const RESEARCH_TOOLS = new Set(["get_stock_data"]);

type UnknownRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is UnknownRecord =>
  typeof v === "object" && v !== null;

function tickerFrom(part: UnknownRecord): string | null {
  // AI SDK v6 puts tool arguments on `input`; older persisted rows used
  // `args`. Accept both — this reads history, so it meets old shapes.
  for (const key of ["input", "args"]) {
    const bag = part[key];
    if (isRecord(bag) && typeof bag.ticker === "string" && bag.ticker.trim()) {
      return bag.ticker.trim().toUpperCase();
    }
  }
  return null;
}

/**
 * Collect researched tickers out of one persisted message array. Handles
 * both shapes that appear in a `thread` row: UIMessage `parts[]`, where a
 * tool call is `type: "tool-<name>"`, and ModelMessage `content[]`, where
 * it is `type: "tool-call"` with a `toolName`.
 */
export function extractResearchedTickers(messages: unknown): string[] {
  if (!Array.isArray(messages)) return [];
  const found = new Set<string>();

  for (const message of messages) {
    if (!isRecord(message)) continue;
    for (const key of ["parts", "content"]) {
      const parts = message[key];
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        if (!isRecord(part)) continue;
        const type = typeof part.type === "string" ? part.type : "";
        const toolName =
          typeof part.toolName === "string"
            ? part.toolName
            : type.startsWith("tool-")
              ? type.slice("tool-".length)
              : "";
        if (!RESEARCH_TOOLS.has(toolName)) continue;
        const ticker = tickerFrom(part);
        if (ticker) found.add(ticker);
      }
    }
  }

  return [...found];
}

/**
 * Read the run's persisted thread and return every ticker it has already
 * researched. Fail-open: any error yields an empty list, which restores
 * exactly the pre-existing behavior (the gate simply asks again).
 */
export async function getResearchedTickersForRun(
  runId: string | null | undefined,
): Promise<string[]> {
  if (!runId) return [];
  try {
    // Imported lazily so the pure extractor above stays unit-testable
    // without booting a Prisma client.
    const { prisma } = await import("@/lib/prisma");
    const rows = await prisma.runMessage.findMany({
      where: { runId },
      select: { content: true },
      orderBy: { createdAt: "desc" },
      take: 4,
    });
    const found = new Set<string>();
    for (const row of rows) {
      const parsed =
        typeof row.content === "string"
          ? (JSON.parse(row.content) as unknown)
          : (row.content as unknown);
      for (const t of extractResearchedTickers(parsed)) found.add(t);
    }
    return [...found];
  } catch {
    return [];
  }
}
