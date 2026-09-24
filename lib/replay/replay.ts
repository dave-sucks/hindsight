/**
 * replay.ts — run a tool's REAL entry point against production-shaped rows
 * (DAV-311).
 *
 * ```ts
 * const { refused, refusal, db } = await replayTool("update-thesis", "updateThesis", {
 *   seed: { thesis: [thesisRow({ ticker: "SMMT", status: "RETIRED", retiredReason: "SOLD" })] },
 *   args: { thesis_id: "thesis_replay", rationale: "Letting it go." },
 * });
 * expect(refused).toBe(false);
 * expect(db.store.thesisUpdate).toHaveLength(1);
 * ```
 *
 * Assert on `refused`, never on `result.ok` — see the `Replay` type below.
 *
 * Three lines instead of forty-five of `jest.mock`. That price is the whole
 * point: the reason four dead rules shipped green is that testing the real
 * path cost more than testing a helper, so the helper is what got tested.
 *
 * ── How it avoids the hoisting problem ────────────────────────────────────
 *
 * `jest.mock` is hoisted to the top of the file, so a helper cannot call it
 * on the test's behalf. `jest.doMock` is not hoisted — it registers at call
 * time — so this runs inside `jest.isolateModulesAsync`, registers the doubled
 * edges, and only then imports the tool. The tool and everything it pulls in
 * are loaded fresh against those doubles, and the registry is restored after.
 * Nothing is required of the test file: no import ordering, no top-level
 * mocks, no reset boilerplate.
 *
 * ── What is doubled, and what is emphatically not ─────────────────────────
 *
 * Doubled: the database, the price vendors, Inngest, and the clock if you
 * pass one. Those are edges — a test cannot reach them and their answers are
 * not the thing under test.
 *
 * NOT doubled: every rule, gate and pure module in between.
 * `checkStatusTransition`, `resolveThesisLadder`, `applyTriggerOps`,
 * `writeThesisUpdate`, plan-sanity, the sizing band — all real, all running
 * against the in-memory store. That is the property that makes a replay test
 * worth writing: it fails when the wiring is wrong, not only when the leaf
 * arithmetic is wrong.
 */

import { prismaDouble, type PrismaDouble, type StoreSeed } from "@/lib/replay/prisma-double";
import {
  REPLAY_ACCOUNT_ID,
  REPLAY_ANALYST_ID,
  REPLAY_RUN_ID,
  REPLAY_USER_ID,
} from "@/lib/replay/rows";

export interface ReplayOptions {
  /** Rows in the database before the tool runs. */
  seed?: StoreSeed;
  /** The tool's arguments, exactly as the model would send them. */
  args?: Record<string, unknown>;
  /** ToolContext overrides — analystId, runMode, runId … */
  ctx?: Record<string, unknown>;
  /** Live price per ticker. Absent ⇒ the quote vendor returns nothing. */
  quotes?: Record<string, number>;
  /** Extra modules to double, e.g. `{ "@/lib/alpaca": () => ({ … }) }`. */
  mocks?: Record<string, () => unknown>;
}

/** What a tool hands back — `ToolResult`, narrowed here to what tests read. */
export interface ReplayResult {
  ok: boolean;
  summary?: string;
  error?: string;
  data?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface Replay {
  /** The raw envelope, for the rare assertion the fields below cannot make. */
  result: ReplayResult;
  /**
   * Did a gate refuse the call?
   *
   * Read this, never `result.ok`. The envelope's top-level `ok` means "the
   * tool ran without throwing" and is `true` on every refusal — so
   * `expect(result.ok).toBe(true)` passes on a rejected call. That is the
   * same class of trap this harness exists to remove, so it is not left
   * lying in the harness itself.
   */
  refused: boolean;
  /** The gate's own code and message when it refused; null when it did not. */
  refusal: { error: string; message: string } | null;
  /** The store after the run — assert the rows the tool actually wrote. */
  db: PrismaDouble;
  /** Every database call the tool made, in order. */
  calls: string[];
}

function readRefusal(r: ReplayResult): { error: string; message: string } | null {
  if (r?.ok === false) {
    return { error: String(r.error ?? "tool_error"), message: String(r.summary ?? "") };
  }
  const data = r?.data as Record<string, unknown> | undefined;
  if (data && data.ok === false) {
    return {
      error: String(data.error ?? "refused"),
      message: String(data.message ?? r.summary ?? ""),
    };
  }
  return null;
}

function quoteStub(quotes: Record<string, number>) {
  return (symbol: string) => {
    const c = quotes[symbol?.toUpperCase?.() ?? symbol];
    if (c == null) return null;
    // `t` is seconds and load-bearing: quote-age refuses a buy on a stale
    // one, so a replay quote is always "now" unless a test says otherwise.
    return { c, d: 0, dp: 0, h: c, l: c, o: c, pc: c, t: Math.floor(Date.now() / 1000) };
  };
}

/**
 * Run `toolModule`'s exported tool through its real `execute`.
 *
 * `toolModule` is the basename under `lib/agent/tools/` ("update-thesis") and
 * `exportName` its export ("updateThesis"). Strings rather than a direct
 * import on purpose: the module has to be imported AFTER the doubles are
 * registered, which means importing it here, not in the test file.
 */
export async function replayTool(
  toolModule: string,
  exportName: string,
  opts: ReplayOptions = {},
): Promise<Replay> {
  const db = prismaDouble(opts.seed);
  const quotes = opts.quotes ?? {};
  let result: ReplayResult = { ok: false, error: "replay did not run" };

  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/actions/finnhub.actions", () => ({
      getStockQuote: jest.fn(async (s: string) => quoteStub(quotes)(s)),
      getCompanyProfile: jest.fn(async () => null),
      getCompanyNews: jest.fn(async () => []),
    }));
    jest.doMock("@/lib/alpaca", () => ({
      getLatestPrices: jest.fn(async (syms: string[]) =>
        Object.fromEntries(syms.map((s) => [s, quotes[s?.toUpperCase?.() ?? s]]).filter(([, v]) => v != null)),
      ),
      getBars: jest.fn(async () => []),
      getAccount: jest.fn(async () => ({
        equity: "100000", cash: "40000", buying_power: "80000", portfolio_value: "100000",
      })),
      getPositions: jest.fn(async () => []),
      getOrder: jest.fn(async () => null),
      getOrderByClientOrderId: jest.fn(async () => null),
      getAllPositions: jest.fn(async () => []),
      getPosition: jest.fn(async () => null),
      getOpenOrders: jest.fn(async () => []),
      getLatestPricesWithMeta: jest.fn(async () => ({})),
      getDailyBars: jest.fn(async () => []),
      getDailyRangePcts: jest.fn(async () => ({})),
      ...Object.fromEntries(
        // The write side, by its real export names. A replay that reaches a
        // broker throws — silence here would be the worst possible failure
        // for a harness whose whole job is to stop silent wrongness.
        ["placeMarketOrder", "placeLimitOrder", "closePosition", "closePositionPartial", "cancelOrder"].map(
          (name) => [
            name,
            jest.fn(async () => {
              throw new Error(`[replay] ${name} reached the broker — a replay must never place or cancel a real order`);
            }),
          ],
        ),
      ),
    }));
    jest.doMock("@/lib/inngest/client", () => ({
      inngest: { createFunction: jest.fn(() => ({})), send: jest.fn(async () => undefined) },
    }));
    for (const [path, factory] of Object.entries(opts.mocks ?? {})) {
      jest.doMock(path, factory);
    }

    const mod = (await import(`@/lib/agent/tools/${toolModule}`)) as Record<string, unknown>;
    const factory = mod[exportName];
    if (typeof factory !== "function") {
      throw new Error(
        `[replay] lib/agent/tools/${toolModule} has no exported tool "${exportName}" ` +
          `(found: ${Object.keys(mod).join(", ") || "nothing"})`,
      );
    }

    const ctx = {
      runId: REPLAY_RUN_ID,
      userId: REPLAY_USER_ID,
      accountId: REPLAY_ACCOUNT_ID,
      analystId: REPLAY_ANALYST_ID,
      runMode: "MORNING_PLAN",
      runEnvironment: "PAPER" as const,
      groupId: (phase: string) => phase,
      ...opts.ctx,
    };

    const tool = (factory as (c: unknown) => { execute: (a: unknown) => Promise<unknown> })(ctx);
    if (typeof tool?.execute !== "function") {
      throw new Error(`[replay] "${exportName}" is not a defineTool factory — no execute()`);
    }
    result = (await tool.execute(opts.args ?? {})) as ReplayResult;
  });

  const refusal = readRefusal(result);
  return { result, refused: refusal !== null, refusal, db, calls: db.calls };
}
