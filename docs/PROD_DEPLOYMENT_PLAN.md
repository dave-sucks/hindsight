# Production Deployment Plan — Per-analyst paper→live promotion

**Status:** Design ready, not started
**PR target:** 5 PRs, each independently shippable
**Migration risk:** LOW. Single user, ~6 enabled analysts, all data backfills to `PAPER`. No downtime.

---

## Goal

Run a single intelligence pipeline and a single run loop, but route each
analyst's *trades* to either the paper account or a real-money account.
Promote analysts one at a time. New analysts always start in paper. The
real-money account is treated as a separate inventory from the paper
account at the data layer so P&L, win-rate, and accuracy reports never
comingle the two.

What we are NOT building in v1:
- Shadow mode (one analyst running paper + live in parallel)
- Daily-loss kill switch (use Alpaca's account-level controls instead)
- First-live-trade confirmation modal
- Account-level promotion (always per-analyst)

---

## Mental model

```
User
  └── UserApiKey (provider=ALPACA, environment=PAPER)   ← paper-api.alpaca.markets
  └── UserApiKey (provider=ALPACA, environment=LIVE)    ← api.alpaca.markets

AgentConfig
  ├── tradingEnvironment: "PAPER" | "LIVE"   ← the promotion flag
  └── realMaxPosition: $X                     ← active only when env=LIVE

ResearchRun
  └── environment   ← snapshot from analyst at run-create time

Position / Order
  └── environment   ← snapshot from run at place_trade time
```

A single intelligence pipeline writes `Signal`/`AnalystSignalRoute` rows.
A single daily-run cron loops every enabled analyst. The *only* thing
that differs between a paper and a live analyst is which `UserApiKey`
row the agent's Alpaca-touching tools resolve to, and which
`environment` tag goes on rows the agent writes.

---

## Promotion semantics — "close paper, preserve theses"

When an analyst is promoted PAPER → LIVE, **all open paper positions
for that analyst are force-closed at market in the paper account** as
part of the promotion transaction. The corresponding theses are NOT
deleted: they remain ACTIVE in the thesis library with no open position.

On the analyst's first live run after promotion:
- `get_portfolio_context` returns zero positions.
- `get_theses` returns the full ACTIVE+WATCHING library, intact.
- Per-thesis review in Stage 2 runs as normal. The agent decides, with
  fresh evidence at current prices, whether each thesis is still worth
  entering. Some become `place_trade` calls; some become
  `update_thesis(INVALIDATED)` or `update_thesis(REVIEWED)`.

Why this and not "mirror at promotion": mirroring at promotion would
instantly fire N market orders in the live account at whatever the
current price is — entries the analyst never decided to make today.
Why not "leave paper positions open": the agent's portfolio state would
be split across two Alpaca accounts; `manage_position` would either fail
(the live account doesn't have the position) or silently land in the
wrong account.

Demotion (LIVE → PAPER) is symmetric and requires all live positions to
be closed first. The UI offers a "close all and demote" one-click flow.

---

## Schema changes

### 1. `AgentConfig` — add `tradingEnvironment`

```prisma
model AgentConfig {
  // ... existing fields ...

  // Replaces realTradingEnabled. Default PAPER on every new analyst.
  // Flipped to LIVE by the promotion action, which also force-closes
  // any open paper positions. See docs/PROD_DEPLOYMENT_PLAN.md.
  tradingEnvironment    String   @default("PAPER")  // "PAPER" | "LIVE"

  // Already exists. Wired up in PR 4 to cap notional on place_trade
  // when tradingEnvironment="LIVE". Ignored when PAPER (paper uses
  // maxPositionSize like today).
  realMaxPosition       Float    @default(500)

  // DROP in PR 1 migration — replaced by tradingEnvironment.
  // realTradingEnabled was never wired to anything.
  // realTradingEnabled    Boolean  @default(false)
}
```

Backfill: every existing row → `tradingEnvironment = "PAPER"`.

### 2. `Position` — add `environment`

```prisma
model Position {
  // ... existing fields ...
  environment   String   @default("PAPER")  // "PAPER" | "LIVE"

  @@index([analystId, environment, status])  // hot path: get-portfolio-context
}
```

Backfill: every existing row → `PAPER`. Also add a new `closeReason`
value `"PROMOTED"` (string, no schema change needed) for positions
closed by the promotion flow.

### 3. `Order` — add `environment`

```prisma
model Order {
  // ... existing fields ...
  environment   String   @default("PAPER")  // "PAPER" | "LIVE"
}
```

Backfill: every existing row → `PAPER`. Used by the sync heartbeat
(`lib/inngest/functions/sync-heartbeat.ts`) so it queries the matching
Alpaca account for each cohort.

### 4. `ResearchRun` — add `environment`

```prisma
model ResearchRun {
  // ... existing fields ...
  // Snapshotted from AgentConfig.tradingEnvironment when the run is
  // created. Locks the env for the duration of the run so a mid-run
  // promotion does not split a run's tool calls across accounts.
  environment   String   @default("PAPER")  // "PAPER" | "LIVE"

  @@index([agentConfigId, environment])
}
```

### 5. `UserApiKey` — two rows per user per provider

```prisma
model UserApiKey {
  // ... existing fields ...

  // Rename of paperMode. PAPER → paper-api.alpaca.markets,
  // LIVE → api.alpaca.markets. Drives the unique key, so a user can
  // hold one PAPER row + one LIVE row for the same provider.
  environment    String   @default("PAPER")  // "PAPER" | "LIVE"

  // DROP after backfill — replaced by environment.
  // paperMode      Boolean  @default(true)

  @@unique([userId, provider, environment])  // was: [userId, provider]
}
```

Backfill SQL:
```sql
ALTER TABLE "UserApiKey" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'PAPER';
UPDATE "UserApiKey" SET "environment" = CASE WHEN "paperMode" THEN 'PAPER' ELSE 'LIVE' END;
ALTER TABLE "UserApiKey" DROP CONSTRAINT "UserApiKey_userId_provider_key";
ALTER TABLE "UserApiKey" ADD CONSTRAINT "UserApiKey_userId_provider_environment_key" UNIQUE ("userId", "provider", "environment");
ALTER TABLE "UserApiKey" DROP COLUMN "paperMode";
```

---

## PR breakdown

| # | Scope | Touches Alpaca? | User-visible? |
|---|-------|-----------------|---------------|
| 1 | Schema + cred resolution + alpaca client paper-flag fix | No live calls yet | No |
| 2 | Settings UI: dual paper/live credential forms | Reads live account at verify time | Yes (settings) |
| 3 | Read-side: Trades/Positions/Dashboard filter by env | No | Yes |
| 4 | Promote/demote action + `realMaxPosition` enforcement | **Yes — first live writes possible** | Yes (analyst detail) |
| 5 | Hardening + first live analyst rollout | Yes | No |

Each PR ships in a state where the existing paper workflow continues
working. You can pause indefinitely between any two PRs.

---

## PR 1 — Foundation: schema + cred resolution + the `paper:true` bug

**Goal:** make the codebase aware of an "environment" axis. No UI, no
behavior change for existing analysts (everything resolves to PAPER).

### Files

**`prisma/schema.prisma`** — apply all 5 model changes above, drop
`AgentConfig.realTradingEnabled`, drop `UserApiKey.paperMode` after
backfill. Single migration file with the SQL above.

**`lib/alpaca.ts:96–116`** — fix the hardcoded `paper: true`. Today:
```ts
const PAPER_BASE_URL = "https://paper-api.alpaca.markets";

function createClient(creds?: AlpacaCredentials): AlpacaAPI {
  if (creds) {
    return new AlpacaAPI({
      keyId: creds.keyId, secretKey: creds.secretKey,
      baseUrl: creds.baseUrl || PAPER_BASE_URL,
      paper: true,   // ← always true, the actual blocker
    });
  }
  // ... env-var fallback ...
  paper: true,       // ← same problem
}
```

Replace with:
```ts
const PAPER_BASE_URL = "https://paper-api.alpaca.markets";
const LIVE_BASE_URL  = "https://api.alpaca.markets";

function createClient(creds?: AlpacaCredentials): AlpacaAPI {
  const baseUrl = creds?.baseUrl
    ?? process.env.ALPACA_BASE_URL
    ?? PAPER_BASE_URL;
  const paper = baseUrl === PAPER_BASE_URL;
  return new AlpacaAPI({
    keyId: creds?.keyId ?? process.env.ALPACA_API_KEY!,
    secretKey: creds?.secretKey ?? process.env.ALPACA_API_SECRET!,
    baseUrl,
    paper,
  });
}
```

Also drop the `_envClient` lazy singleton — once we have two
environments per user it stops being a safe cache. Always call
`createClient(creds)` per request.

**`lib/actions/api-keys.actions.ts:235–255`** — change signature:
```ts
export async function resolveAlpacaCredentials(
  userId: string,
  environment: "PAPER" | "LIVE" = "PAPER",
): Promise<AlpacaCredentials | null> {
  const row = await prisma.userApiKey.findUnique({
    where: { userId_provider_environment: { userId, provider: "ALPACA", environment } },
    select: { encryptedKey: true, encryptedSecret: true, baseUrl: true, environment: true },
  });
  if (!row) return null;
  return {
    keyId: unpackAndDecrypt(row.encryptedKey),
    secretKey: unpackAndDecrypt(row.encryptedSecret),
    baseUrl: row.baseUrl ?? (environment === "LIVE"
      ? "https://api.alpaca.markets"
      : "https://paper-api.alpaca.markets"),
  };
}
```

**Every caller of `resolveAlpacaCredentials`** must pass an
environment. Per-analyst callsites read from
`analyst.tradingEnvironment`. Default-PAPER callsites stay PAPER. Audit:

- `app/api/agent/[mode]/route.ts` — pass `analyst.tradingEnvironment`
- `lib/inngest/functions/morning-research.ts` — same, per-analyst inside the per-analyst step
- `lib/inngest/functions/tactical-run.ts` — same
- `lib/inngest/functions/discovery-run.ts` — same
- `lib/inngest/functions/price-monitor.ts` — group OPEN positions by
  environment, resolve creds once per (userId, env), iterate
- `lib/inngest/functions/trade-evaluator.ts` — read env off the closed
  Position row
- `lib/inngest/functions/eod-evaluation.ts` — same
- `lib/inngest/functions/sync-heartbeat.ts` — same as price-monitor

**`app/api/research/agent-run/route.ts`** — when creating the
ResearchRun row, snapshot `environment: analyst.tradingEnvironment`.

**`lib/agent/tools/place-trade.ts`** — set `environment` on the
Position and Order rows it creates. Pull from `ctx.runEnvironment`
(new field on ToolContext, populated in `createToolContext()`).

**`lib/agent/tool-context.ts`** — add `runEnvironment: "PAPER" | "LIVE"`.

**`lib/agent/tools/get-portfolio-context.ts`** — filter positions by
`environment: ctx.runEnvironment` so the agent only sees the cohort
matching its run.

**`lib/agent/tools/close-position.ts`** and
**`lib/agent/tools/manage-position.ts`** — defensive check: refuse to
operate on a Position whose `environment` differs from
`ctx.runEnvironment`, return an error result. Should never happen
because get-portfolio-context filters, but cheap insurance.

### What this PR does NOT do

- Does not add any UI.
- Does not let you save a LIVE credential row (the form still only
  writes PAPER).
- Does not let you promote an analyst.
- After PR 1, every analyst is `PAPER` and every position is `PAPER`.
  System behavior is identical to today.

---

## PR 2 — Dual paper/live credential forms

**Goal:** let the user save a LIVE Alpaca key alongside the PAPER one,
verified against the live account.

### Files

**`components/settings/AlpacaKeyForm.tsx`** — split into two stacked
panels: "Paper trading account" and "Live trading account". Each panel
has its own key/secret inputs, save button, verified badge, delete
button. The panel passes `environment` to:

**`lib/actions/api-keys.actions.ts`** — `saveApiKey()` /
`deleteApiKey()` / `getApiKeyStatus()` all gain an `environment`
parameter. `getApiKeyStatus()` returns `{ paper: ..., live: ... }`
so the settings page can render both badges.

**`app/(root)/settings/page.tsx`** — pass both statuses into the form
component.

Verification: `saveApiKey({ environment: "LIVE" })` calls
`getAccount({ keyId, secretKey, baseUrl: "https://api.alpaca.markets" })`.
A successful response sets `verified=true` and is the moment we touch
real Alpaca for the first time — purely read-only.

### Guard against accidental promotion

In PR 2 the analyst still can't be promoted (no UI). Even if you saved
a LIVE key, nothing in the system would consume it yet. This is
intentional separation.

---

## PR 3 — Read-side: filter Trades / Positions / Dashboard / Performance by environment

**Goal:** prepare the UI so once live trades start landing, they don't
mix into paper P&L charts.

### Files

**`components/trades/TradesPage.tsx`** — add a tab strip:
`All | Paper | Live`. Default to `Live` if the user has any LIVE
trades, else `Paper`. Filter by `Position.environment`.

**`app/(root)/page.tsx`** (Dashboard) — portfolio summary, P&L
totals, Today's Picks all scope to whichever env the user currently
has the dashboard pinned to. Add an env selector in the page header
that persists in user settings (or just URL state in v1).

**`app/(root)/performance/page.tsx`** — env tab strip. AccuracyReport
calibration is per-analyst; in v1 just split the leaderboard into
paper analysts vs live analysts. Don't re-roll metrics.

**`components/agent/PortfolioSnapshotCard.tsx`** and similar —
respect the env scope of the run/page they're rendered in.

**No backend changes.** Every read already had analystId/userId
filters; we just add an `environment` filter alongside.

---

## PR 4 — Promote, demote, and the `realMaxPosition` cap

**Goal:** the actual promotion action and the cap that makes live
trading safe.

### Files

**`app/(root)/analysts/[id]/AnalystDetailClient.tsx`** — add a
"Promote to live" button in the analyst header when
`tradingEnvironment === "PAPER"` and the user has a verified LIVE
Alpaca key. When `tradingEnvironment === "LIVE"`, show "Demote to
paper" instead.

**`components/analysts/PromoteToLiveDialog.tsx`** — new file. Modal
shows:
- Analyst name + current env badge
- "Open paper positions that will be closed: N"
  (list of ticker + qty + current P&L)
- "After promotion this analyst will place real-money trades using
  your live Alpaca account."
- "Position size cap on live: $X" (from `realMaxPosition`, editable in
  the modal)
- Text confirmation: type the analyst name to enable the button

**`components/analysts/DemoteToPaperDialog.tsx`** — new file. Modal
shows current live positions, requires "close all and demote" or
blocks if any are open with a "close these first" link.

**`lib/actions/promote-analyst.actions.ts`** — new server action.
Pseudocode:
```ts
export async function promoteAnalystToLive(analystId: string) {
  const user = await requireUser();
  const analyst = await prisma.agentConfig.findFirstOrThrow({
    where: { id: analystId, userId: user.id },
  });
  if (analyst.tradingEnvironment === "LIVE") return { ok: true, noop: true };

  const liveCreds = await resolveAlpacaCredentials(user.id, "LIVE");
  if (!liveCreds) return { ok: false, error: "NO_LIVE_CREDS" };
  await getAccount(liveCreds); // verify still reachable

  const paperCreds = await resolveAlpacaCredentials(user.id, "PAPER");
  const openPaper = await prisma.position.findMany({
    where: { analystId, environment: "PAPER", status: "OPEN" },
  });

  // Close each in paper Alpaca (best-effort, log failures)
  for (const p of openPaper) {
    try {
      await closePosition(p.symbol, paperCreds!);
      // closePosition already updates the Position row via the existing
      // close-trade pipeline. We just mark closeReason once it lands.
      await prisma.position.update({
        where: { id: p.id },
        data: { closeReason: "PROMOTED", closeSource: "user" },
      });
    } catch (err) {
      // Surface in the dialog. Do NOT flip the env flag if any close failed.
      throw new PromotionError("PAPER_CLOSE_FAILED", { symbol: p.symbol, err });
    }
  }

  // Theses stay ACTIVE with no positions. Next live run reviews them.
  await prisma.agentConfig.update({
    where: { id: analystId },
    data: { tradingEnvironment: "LIVE" },
  });

  return { ok: true };
}
```

**`lib/agent/tools/place-trade.ts`** — enforce the per-analyst cap:
```ts
const cap = ctx.runEnvironment === "LIVE"
  ? config.realMaxPosition
  : config.maxPositionSize;

if (notional > cap) {
  return toolError(`Order notional $${notional} exceeds the $${cap} per-position cap.`);
}
```
The cap is the only safety net in v1 between the agent and an oversized
live order. It must be checked server-side, never relied on from the
prompt alone.

### Operational checklist for the first promotion

1. Settings → save + verify LIVE Alpaca key.
2. Open the analyst with the most paper trades and best calibration.
3. Set `realMaxPosition` to a number you can lose comfortably (e.g.
   $200 for the first week).
4. Promote.
5. Watch the next morning's run end-to-end.

---

## PR 5 — Hardening

**Goal:** find the rough edges before promoting a second analyst.

### Tasks

- **Cron audit pass.** For each Inngest function listed in PR 1,
  manually trace one execution per env. Confirm price-monitor cohorts
  by env, no cross-env Alpaca calls, no PAPER cred used to close a
  LIVE position.
- **Sync heartbeat.** `lib/inngest/functions/sync-heartbeat.ts`
  reconciles DB Position rows vs Alpaca. After PR 1 it must query
  *both* Alpaca accounts per user and reconcile each cohort
  independently. Add env to `SyncHealthSnapshot`.
- **Trade-opened / trade-closed email templates** (already shipped per
  TRADE_ALERTS_PLAN) — add a "[LIVE]" prefix to the subject line when
  `position.environment === "LIVE"`. One-line change in
  `lib/agent/tools/place-trade.ts` and `lib/actions/closeTrade.actions.ts`.
- **Weekly digest** — split paper vs live in the per-analyst rollup.
- **Idempotency check.** Confirm `Order.idempotencyKey` still works as
  the join key when crash-recovering a live order. The path is the
  same as paper, but worth one explicit test against the live account
  with a $1 fractional share.
- **Manual end-to-end with one promoted analyst** for one full trading
  week before promoting the second.

---

## Risks and known gotchas

1. **The first live order is irreversible.** The cap in PR 4 plus
   `realMaxPosition` is the safety net. Set it small for the first
   month.
2. **Pattern-Day-Trader rule** doesn't exist on paper accounts.
   Promoted analysts can trip PDT and have their live account
   restricted. Not handled in v1; mitigate by setting
   `holdDurations` to SWING/POSITION-only on the first promoted
   analyst.
3. **Shorting on live** requires margin approval — different from
   paper. The analyst will still call `place_trade(direction:"short")`;
   Alpaca will reject. PR 5 should add an error path that
   `update_thesis(INVALIDATED, reason:"BROKER_REJECTED_SHORT")` so the
   analyst learns to stop trying.
4. **No daily-loss kill switch in v1.** Use Alpaca's account-level
   trading-suspended toggle if a single day goes badly. Add an
   automated kill switch in a follow-up.
5. **Promotion is partial-failure-prone.** If 5 of 7 paper positions
   close cleanly and the 6th errors, the analyst is left half-closed
   and not yet promoted. The action throws and rolls back the env
   flip. User must reopen the dialog; the 5 already-closed positions
   stay closed. The dialog should make this clear: "promotion failed
   on $TICKER, 5 positions already closed; close $TICKER manually and
   retry."
6. **`maxOpenPositions` and `dailyLossLimit`** on AgentConfig
   currently apply to paper. They should continue to apply per-env in
   live too. PR 4 should confirm the enforcement sites read the
   correct env-scoped position count.
