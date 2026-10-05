/**
 * pre-catalyst-window.cort-replay.test.ts — a pre-event buy is told where it
 * stands against the one buying window, and so is Dave (DAV-338).
 *
 * CORT, Catalyst Event PM, FDA decision Dec 17. At 10:30 ET on 2026-09-29
 * its "within 3% of the 50-day" buy fired at $113.71 and the trigger run
 * (cmumrwuc9000004kzdx50i05j) proposed 43 shares — 79 days before the
 * event, 9 days before the pre-catalyst setup's window opens. Nothing told
 * it so: the kickoff carried the fire and the 50-day, and the proposal
 * carried the sizing and the book. The run checked only the 21-day inner
 * edge ("well outside the last 21 days").
 *
 * The window is information, not a gate (QB ruling 2026-09-29): the run is
 * told, it decides, and the proposal carries the same line. Both halves run
 * through their real entry points here — the trigger run's own handler (the
 * model call captured, not made) and place_trade — against CORT's rows
 * (lib/agent/__fixtures__/cort-pre-catalyst-buy-2026-09-29.json).
 */
import raw from "@/lib/agent/__fixtures__/cort-pre-catalyst-buy-2026-09-29.json";
import {
  replayTool,
  prismaDouble,
  thesisRow,
  agentConfigRow,
  accountRow,
  REPLAY_ACCOUNT_ID,
  REPLAY_ANALYST_ID,
  REPLAY_USER_ID,
} from "@/lib/replay";

const fx = raw as unknown as {
  run: { startedAt: string; parameters: { thesisId: string; triggerId: string; action: string; predicateKind: string } };
  kickoff: Array<{ type: string; text: string }>;
  thesis: Record<string, unknown> & { id: string; catalystDate: string; createdAt: string; triggers: unknown[] };
  placeTrade: Record<string, unknown>;
  proposal: { createdAt: string; rationale: string };
  analyst: Record<string, unknown> & { setupIds: string[]; triggers: unknown[] };
};

const LINE =
  "Buying window: 79 days to the event date (Dec 17), 9 days before this setup's window opens (Oct 8). " +
  "This setup buys 70 to 21 days before the event.";

/** What the evaluator put on the fire: the 50-day numbers behind "within 3%". */
const FIRED_CONTEXT = "50-day $111.29; price $113.71 (+2.2% from it)";

const seed = () => ({
  thesis: [
    thesisRow({
      ...fx.thesis,
      catalystDate: new Date(fx.thesis.catalystDate),
      createdAt: new Date(fx.thesis.createdAt),
      analystId: REPLAY_ANALYST_ID,
    }),
  ],
  agentConfig: [
    agentConfigRow({
      name: "Catalyst Event PM",
      analystPrompt: "You trade dated binary events.",
      sectors: [],
      tradingEnvironment: "LIVE",
      setupIds: fx.analyst.setupIds,
      minConfidence: fx.analyst.minConfidence,
      minPositionSize: fx.analyst.minPositionSize,
      maxPositionSize: fx.analyst.maxPositionSize,
      maxPositionTotal: fx.analyst.maxPositionTotal,
      maxOpenPositions: fx.analyst.maxOpenPositions,
      riskPct: fx.analyst.riskPct,
      triggers: fx.analyst.triggers,
    }),
  ],
  account: [
    accountRow({
      triggers: [],
      triggersSeededAt: new Date("2026-09-18T12:00:00Z"),
      requireApprovalBuysLive: true,
      requireApprovalSellsLive: true,
      requireApprovalBuysPaper: true,
      requireApprovalSellsPaper: true,
    }),
  ],
});

/** Run `fn` with only the clock set to `at`; timers and microtasks stay real. */
async function at<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: ["hrtime", "nextTick", "performance", "queueMicrotask", "setImmediate", "clearImmediate", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
  });
  try {
    return await fn();
  } finally {
    jest.useRealTimers();
  }
}

/** The trigger run's handler for CORT's fire; returns what it sent the model first. */
async function triggerRunKickoff(): Promise<string> {
  const db = prismaDouble(seed());
  const prompts: string[] = [];
  await jest.isolateModulesAsync(async () => {
    let handler: ((ctx: unknown) => Promise<unknown>) | undefined;
    jest.doMock("@/lib/prisma", () => ({ prisma: db }));
    jest.doMock("@/lib/inngest/client", () => ({
      inngest: {
        createFunction: (_c: unknown, _t: unknown, fn: typeof handler) => {
          handler = fn;
          return {};
        },
        send: jest.fn(),
      },
    }));
    // The model is the edge: capture what it is told, answer nothing.
    jest.doMock("ai", () => ({
      generateText: jest.fn(async (args: { prompt?: string }) => {
        if (args.prompt) prompts.push(args.prompt);
        return { steps: [], response: { messages: [] }, text: "" };
      }),
      stepCountIs: () => () => false,
    }));
    jest.doMock("@ai-sdk/openai", () => ({ openai: () => ({}) }));
    jest.doMock("@/lib/agent/tools", () => ({ createResearchTools: () => ({}) }));
    jest.doMock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: async () => null }));
    await import("@/lib/inngest/functions/tactical-run");
    await handler!({
      event: {
        data: {
          thesisId: fx.thesis.id,
          triggerId: fx.run.parameters.triggerId,
          analystId: REPLAY_ANALYST_ID,
          ticker: "CORT",
          action: fx.run.parameters.action,
          predicateKind: fx.run.parameters.predicateKind,
          firedPrice: 113.71,
          firedContext: FIRED_CONTEXT,
        },
      },
      step: {
        // Inngest hands a step's result across as JSON.
        run: async (_name: string, fn: () => Promise<unknown>) => {
          const out = await fn();
          return out === undefined ? undefined : JSON.parse(JSON.stringify(out));
        },
        sendEvent: jest.fn(),
      },
    });
  });
  // doMock outlives the isolated registry; leave nothing faked for the next test.
  for (const m of ["ai", "@ai-sdk/openai", "@/lib/agent/tools", "@/lib/actions/api-keys.actions", "@/lib/inngest/client", "@/lib/prisma"]) {
    jest.dontMock(m);
  }
  if (prompts.length === 0) throw new Error("the trigger run never reached the model");
  return prompts[0];
}

describe("CORT 2026-09-29 — a pre-event buy 79 days out", () => {
  it("the trigger run is told the days to the event and where the setup's window is", async () => {
    const kickoff = await at(fx.run.startedAt, triggerRunKickoff);
    // On main this was production's kickoff, word for word.
    const production = fx.kickoff[0].text;
    const [head, tail] = production.split(` ${FIRED_CONTEXT} `);
    // The trigger reads as the pill says it now; the rest is production's, word for word.
    const said = head.replace("Within 3% of the 50-day — consider entry.", "Buy if within 3% of the 50-day average.");
    expect(kickoff).toBe(`${said} ${FIRED_CONTEXT} ${LINE} ${tail}`);
  });

  it("the proposal it makes carries the same line, and is still a proposal", async () => {
    const { refused, result, db } = await at(fx.proposal.createdAt, () =>
      replayTool("place-trade", "placeTrade", {
        seed: seed(),
        ctx: {
          runMode: "INTRADAY_TACTICAL",
          runEnvironment: "LIVE",
          accountId: REPLAY_ACCOUNT_ID,
          userId: REPLAY_USER_ID,
          minPositionSize: fx.analyst.minPositionSize,
          maxPositionSize: fx.analyst.maxPositionSize,
          maxOpenPositions: fx.analyst.maxOpenPositions,
        },
        // The call the run made, verbatim; the analyst id is the chat's
        // fallback — the run is scoped to its analyst.
        args: { ...fx.placeTrade, analyst_id: undefined },
        quotes: { CORT: 113.71 },
        // The industry line reads Finnhub through research-helpers, which
        // the harness doesn't double; keep the test off the network.
        mocks: {
          "@/lib/agent/research-helpers": () => ({
            ...jest.requireActual("@/lib/agent/research-helpers"),
            finnhub: async () => ({ data: null, error: "replay" }),
          }),
        },
      }),
    );
    expect(refused).toBe(false);
    expect(result.data?.status).toBe("PROPOSED");
    const order = (db.store.order as Array<Record<string, unknown>>)[0];
    expect(order.status).toBe("AWAITING_APPROVAL");
    expect(order.rationale as string).toContain(LINE);
    // What production's proposal carried, and still does: the run's own
    // words first, the sizing after.
    expect(order.rationale as string).toContain("I am buying $CORT here because the pre-FDA setup is still intact");
    expect(fx.proposal.rationale).not.toContain("Buying window");
  });
});
