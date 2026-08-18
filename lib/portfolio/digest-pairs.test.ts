/**
 * digest-pairs.test.ts — pins the digest pair-selection gate.
 *
 * The headline fixture mirrors the real bug (2026-08): every analyst on the
 * account was promoted to LIVE, yet PRINCIPAL_CHAT / THESIS_WRITER runs
 * (which default environment=PAPER) kept counting as paper "activity" and a
 * PAPER digest was written every day. With the gate, a run only earns a
 * digest when its environment is actually being traded.
 */

import {
  selectDigestPairs,
  TRADING_RUN_MODES,
  type EnvPair,
} from "./digest-pairs";

const ACC = "acct_1";
const paper: EnvPair = { accountId: ACC, environment: "PAPER" };
const live: EnvPair = { accountId: ACC, environment: "LIVE" };

describe("TRADING_RUN_MODES", () => {
  it("is exactly the three trading modes — chat/writer/podcast never count", () => {
    expect([...TRADING_RUN_MODES].sort()).toEqual([
      "DISCOVERY",
      "INTRADAY_TACTICAL",
      "MORNING_PLAN",
    ]);
  });
});

describe("selectDigestPairs", () => {
  it("headline: all analysts LIVE, paper run activity only → no PAPER digest", () => {
    // A trading-mode run snapshotted PAPER (e.g. stale/disabled config), but
    // the account has zero enabled paper analysts and zero open paper
    // positions. LIVE is traded and ran today.
    const pairs = selectDigestPairs({
      tradingRunPairs: [paper, live],
      positionActivityPairs: [],
      tradedEnvPairs: [live],
    });
    expect(pairs).toEqual([live]);
  });

  it("trading run in a traded env → digest", () => {
    const pairs = selectDigestPairs({
      tradingRunPairs: [live],
      positionActivityPairs: [],
      tradedEnvPairs: [live],
    });
    expect(pairs).toEqual([live]);
  });

  it("position activity alone is digest-worthy, even with no enabled analyst", () => {
    // Wind-down day: the last PAPER position was closed today, all analysts
    // already promoted. The close is real trading — digest it.
    const pairs = selectDigestPairs({
      tradingRunPairs: [],
      positionActivityPairs: [paper],
      tradedEnvPairs: [],
    });
    expect(pairs).toEqual([paper]);
  });

  it("a traded env with NO activity today gets no digest (don't write empty rows)", () => {
    const pairs = selectDigestPairs({
      tradingRunPairs: [],
      positionActivityPairs: [],
      tradedEnvPairs: [live, paper],
    });
    expect(pairs).toEqual([]);
  });

  it("dedupes a pair that qualifies via both routes", () => {
    const pairs = selectDigestPairs({
      tradingRunPairs: [live, live],
      positionActivityPairs: [live],
      tradedEnvPairs: [live],
    });
    expect(pairs).toEqual([live]);
  });

  it("keeps accounts independent", () => {
    const otherLive: EnvPair = { accountId: "acct_2", environment: "LIVE" };
    // acct_2 ran but only acct_1 trades LIVE — acct_2 is gated out.
    const pairs = selectDigestPairs({
      tradingRunPairs: [live, otherLive],
      positionActivityPairs: [],
      tradedEnvPairs: [live],
    });
    expect(pairs).toEqual([live]);
  });
});
