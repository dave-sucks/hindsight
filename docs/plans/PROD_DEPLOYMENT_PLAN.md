# Production Deployment Plan — Per-analyst paper→live promotion

**Status:** Foundation shipped on branch `claude/plan-prod-deployment-LhbLY`. Read-side env coverage rolling out — see "Filtering rollout" below.
**Migration risk:** LOW. Single user, ~6 enabled analysts, all data backfills to `PAPER`. No downtime.

---

## What shipped

- **Schema** — `tradingEnvironment` on AgentConfig, `environment` on Position, Order, ResearchRun, and UserApiKey. Composite unique key `(userId, provider, environment)` so each user holds one PAPER + one LIVE row. Backfills everything to PAPER.
- **alpaca.ts** — derives the SDK `paper` flag from `baseUrl` instead of hardcoding `true`. Drops the env-client singleton.
- **ToolContext.runEnvironment** — snapshotted onto ResearchRun at create time; threaded through every tool and every cron.
- **place_trade / manage_position / close_position** — tag new rows with env; env-defensive lookups so a LIVE run never operates on a PAPER position (and vice versa).
- **Inngest crons** — morning-research, tactical-run, discovery-run snapshot env per-analyst. reconcile-orders groups by (userId, env). intraday-eod-flatten resolves creds per position env.
- **Settings UI** — two stacked AlpacaKeyForm cards (PAPER + LIVE) with separate verification.
- **Promote / Demote** — `lib/actions/promote-analyst.actions.ts` + `PromoteAnalystDialog`. Promotion validates live creds, force-closes paper positions (closeReason=PROMOTED), writes a ThesisUpdate audit row on each affected thesis ("Paper position closed at $X during promotion to LIVE — re-enter by default on next live run unless target approached or new evidence against"), flips the flag. Demotion is symmetric with a "close all and demote" path.
- **First-live-run rebuy steering** — Stage 2 of `lib/agent/system-prompt.ts` has a "first live run after promotion" special case. Default action on a thesis with a recent promotion audit row + no live position is `place_trade` at current price; opt-out only on target-approached or concrete invalidation.
- **realMaxPosition cap** — `place_trade` size guardrail uses `min(maxPositionSize, realMaxPosition)` on LIVE runs.
- **Email subjects** — `[LIVE] ` prefix on trade-opened and trade-closed alerts.
- **Global env switcher** — Stripe-style cookie-backed environment in the top header (`components/settings/EnvironmentSwitcher.tsx`). Visible only when the user has any live key / position / analyst. Single source of truth read via `getCurrentEnvironment()` server action.

## Filtering rollout

The global switcher means each page just needs a one-line scope on its data fetch. Pages already converted:

- ✅ `/` Dashboard
- ✅ `/trades`
- ✅ `/runs`
- ✅ `/performance`
- ✅ `/analysts` (grid + per-analyst aggregates)
- ✅ Per-run tool data (via `runEnvironment` on ToolContext)

Pages that still pull cross-env data and need converting:

- [ ] `/analysts/[id]` detail — env badge in header is wired, but the Trades / Theses / Briefs tabs still aggregate across both envs. Not breaking today (an analyst is single-env at any moment), but on a promoted analyst the paper history mixes into the live tab.
- [ ] Thesis listings on the run page and analyst detail
- [ ] `/intelligence` — signals are firm-wide inputs (correctly cross-env), but the Activity / Briefs panels currently show both envs interleaved. Add env scope where it's a *result* (briefs, run activity) and leave it alone where it's an *input* (signals, monitors).
- [ ] `/stocks/[symbol]` — the per-ticker page shows positions/theses across envs; on a promoted analyst with both paper history and live position you'd see both stacked. Scope to current env.
- [ ] Weekly digest email — currently aggregates cross-env. Should split by env or filter to current env.

## Deploying schema changes — AUTOMATIC since 2026-08-09

**Merging a migration is now enough.** The `build` script starts with
`node scripts/deploy-migrate.mjs`, which runs `prisma migrate deploy` on
**production builds only**. Vercel builds, *then* promotes — so the schema is
in place before the new code serves its first request, and a failed migration
fails the build instead of shipping code that can't talk to its own database.

> **History:** this was manual for months. `build` was `prisma generate &&
> next build`, nothing applied migrations, and every schema change had to be
> run by hand. Forgetting produced "Application error: a server-side exception
> has occurred" on every page. It bit `20260512000000_trading_environment`,
> and again on `20260809000000_analyst_min_position_size`, where the
> production deploy went READY **~2 minutes before** the column was added by
> hand — only the late hour kept it off the morning cron. The cleanup was
> blocked on `_prisma_migrations` being out of sync; PR #500's
> `migrate resolve --applied` pass fixed that, and `migrate deploy` now reports
> a clean "No pending migrations to apply" against prod.

**Rules that keep it working:**

- **`DIRECT_URL` must stay set in the Vercel Production environment.** It is
  the connection `prisma.config.ts` hands to migrations. It must NOT be the
  runtime `DATABASE_URL` — that's Supabase's transaction pooler (port 6543),
  which can't hold the session-level advisory lock `migrate deploy` takes. Use
  the direct connection (`db.<ref>.supabase.co:5432`) or the **session** pooler
  (`aws-0-<region>.pooler.supabase.com:5432`). Prefer the session pooler on
  Vercel: the direct host is IPv6-only without the IPv4 add-on. If `DIRECT_URL`
  is missing, the build **fails on purpose** with instructions — production
  keeps serving the previous deployment, so a missing var costs you a deploy,
  never an outage.
- **Preview deployments deliberately do NOT migrate.** They build from unmerged
  branches against the *same* production database; letting them migrate would
  apply unreviewed schema changes the moment someone opened a PR. Consequence:
  a preview of a PR that adds a migration shows errors for the new columns
  until it merges. That's the intended trade — a broken preview is cheap, a
  prod schema mutated by an abandoned branch is not.
- **Destructive migrations still need care.** Rolling back a deployment rolls
  back *code*, not schema. Additive changes (new nullable/defaulted columns —
  nearly all of ours) are rollback-safe. A `DROP`/`RENAME`/`NOT NULL`-without-
  default is not: rolling back leaves old code querying something gone. Ship
  those as an expand/contract pair across two deploys.
- **One-off data heals still go in `prisma/manual-sql/`** and are still run by
  hand. This automation covers `prisma/migrations/` only.

## What we are NOT building

- Shadow mode (one analyst running paper + live in parallel).
- Daily-loss kill switch (Alpaca's account-level toggle is enough for v1).
- First-live-trade confirmation modal (the dialog already requires typing the analyst name).
- Account-level promotion (always per-analyst — keep the surface small).

---

## Original plan (kept for reference)

**PR target:** 5 PRs (now shipped as 12 sequential commits on the foundation branch).
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
