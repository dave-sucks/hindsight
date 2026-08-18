/**
 * digest-pairs.ts — pure pair-selection for the EOD portfolio digest cron.
 *
 * Decides which (accountId, environment) pairs get a digest today. The bug
 * this pins down: non-trading run modes (PRINCIPAL_CHAT, THESIS_WRITER,
 * podcast runs) default environment=PAPER, so any chat counted as PAPER
 * "activity" and kept writing paper digests for an account whose analysts
 * had all been promoted to LIVE.
 *
 * The rule: a digest is written only for environments actually being traded.
 *   - Position activity today (an open or a close) IS trading in that env —
 *     always digest-worthy, even on the day the last position winds down.
 *   - A trading-mode run (MORNING_PLAN / INTRADAY_TACTICAL / DISCOVERY)
 *     counts only if the env is live-traded: at least one enabled analyst
 *     with tradingEnvironment=env, or an OPEN position in that env.
 */

/** Run modes that constitute trading activity for digest purposes. */
export const TRADING_RUN_MODES = [
  "MORNING_PLAN",
  "INTRADAY_TACTICAL",
  "DISCOVERY",
] as const;

export interface EnvPair {
  accountId: string;
  environment: string;
}

const key = (p: EnvPair) => `${p.accountId}::${p.environment}`;

export function selectDigestPairs(input: {
  /** Pairs with a trading-mode ResearchRun today. */
  tradingRunPairs: EnvPair[];
  /** Pairs with a Position opened or closed today. */
  positionActivityPairs: EnvPair[];
  /** Pairs actually being traded: enabled analyst in env, or OPEN position in env. */
  tradedEnvPairs: EnvPair[];
}): EnvPair[] {
  const traded = new Set(input.tradedEnvPairs.map(key));
  const seen = new Map<string, EnvPair>();

  for (const p of input.positionActivityPairs) {
    seen.set(key(p), { accountId: p.accountId, environment: p.environment });
  }
  for (const p of input.tradingRunPairs) {
    if (traded.has(key(p))) {
      seen.set(key(p), { accountId: p.accountId, environment: p.environment });
    }
  }
  return [...seen.values()];
}
