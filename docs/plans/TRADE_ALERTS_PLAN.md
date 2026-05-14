# Trade Alerts Plan — Email on trades + daily run digest

**Status:** Design ready, not started  
**PR target:** Single PR, many commits  
**Depends on:** Nothing. Resend already wired (`lib/email.ts`). No schema changes needed.

---

## Summary

Three alert types:

| Alert | When | Already built? |
|-------|------|----------------|
| Trade opened | Immediately after `place_trade` fills | ❌ needs hook + template |
| Trade closed | Immediately after any close | ✅ exists — verify it works |
| Daily run digest | 10 AM ET Mon-Fri, all analysts | ❌ needs cron + template |

The weekly digest (`lib/inngest/functions/weekly-digest.ts`) already exists and is complete. Don't touch it — it covers Sunday's roll-up.

---

## Alert 1: Trade Opened (immediate, per-trade)

### Hook point

**`lib/agent/tools/place-trade.ts`** — after the `prisma.position.create()` call succeeds and the Alpaca order is confirmed, before the function returns.

Read the file first. The position is created inside a large try/catch block. The pattern is:

```ts
// After the position row is created and order confirmed:
if (ctx.analystId) {
  const config = await prisma.agentConfig.findUnique({
    where: { id: ctx.analystId },
    select: { emailAlerts: true, name: true },
  });
  if (config?.emailAlerts) {
    const email = await getUserEmail(ctx.userId);
    if (email) {
      void sendEmail({
        to: email,
        subject: `${args.direction === "long" ? "📈 Bought" : "📉 Shorted"} ${args.ticker} — ${config.name}`,
        html: tradeOpenedHtml({
          ticker: args.ticker,
          direction: args.direction,
          qty: filledQty,
          avgCost: avgCostNum,
          stopLoss: args.stopLoss,
          targetPrice: args.targetPrice,
          analystName: config.name,
          thesisSummary: args.thesis_summary, // if available in args
        }),
      });
    }
  }
}
```

`void` (fire-and-forget) — same pattern as `closeTrade.actions.ts`. Never `await` email sends in the trade path.

Add imports at top of the file:
```ts
import { sendEmail, getUserEmail } from "@/lib/email";
import { tradeOpenedHtml } from "@/lib/emails/trade-opened";
```

### Template: `lib/emails/trade-opened.ts` — new file

```ts
export function tradeOpenedHtml(args: {
  ticker: string;
  direction: "long" | "short";
  qty: number;
  avgCost: number;
  stopLoss?: number;
  targetPrice?: number;
  analystName: string;
  thesisSummary?: string;
}): string
```

**Visual design:** Match `trade-closed.ts` style (dark background `#0f0f0f`, white text, monospaced numbers).

**Content layout:**
```
[BOUGHT / SHORTED] TICKER
Analyst: {analystName}

{qty} shares @ ${avgCost}
Stop loss:    ${stopLoss}       (–X.X% from entry)
Price target: ${targetPrice}    (+X.X% from entry)
Risk/reward:  X.X:1

{thesisSummary if present, truncated to 200 chars}
```

Compute stop % and target % inline in the template function. If `stopLoss` or `targetPrice` is null, show "—" for those lines.

---

## Alert 2: Trade Closed (already built — verify)

### Verify it works

`lib/actions/closeTrade.actions.ts` line ~355 emits `{ name: "trade/closed", data: { positionId } }` via Inngest. There should be a handler consuming that event.

**Find the handler:** grep for `"trade/closed"` across `lib/inngest/functions/`. Read whatever file handles it. Confirm it:
1. Fetches the position + outcome + P&L
2. Calls `getUserEmail(position.userId)`
3. Calls `sendEmail()` with `trade-closed.ts` template
4. Is registered in `lib/inngest/functions/index.ts` (or wherever the Inngest function registry is)

If the handler exists and is registered: no changes needed.  
If it exists but is NOT registered: add it to the registry.  
If it doesn't exist: create it (see template spec below as fallback).

### Template reference: `lib/emails/trade-closed.ts` (existing)

Already built. Shows: WIN/LOSS label, ticker, P&L%, entry price, exit price, days held, close reason. Do not modify.

---

## Alert 3: Daily Run Digest (10 AM ET, consolidated)

### New Inngest function: `lib/inngest/functions/daily-run-digest.ts`

```ts
export const dailyRunDigest = inngest.createFunction(
  { id: "daily-run-digest", name: "Daily Run Digest Email" },
  { cron: "TZ=America/New_York 0 10 * * 1-5" }, // 10 AM ET Mon-Fri
  async ({ step }) => { ... }
);
```

### What it does

1. **Find all analysts with `emailAlerts: true`** and their owners:
   ```ts
   const analysts = await prisma.agentConfig.findMany({
     where: { emailAlerts: true, isEnabled: true },
     select: { id: true, name: true, userId: true },
   });
   ```

2. **Group by owner userId** — one email per owner, not one per analyst.

3. **For each owner, gather this morning's data** (after 6 AM ET today):
   ```ts
   const morningStart = new Date();
   morningStart.setHours(6, 0, 0, 0); // 6 AM local; Inngest runs in ET

   // Trades opened this morning
   const newPositions = await prisma.position.findMany({
     where: {
       userId: ownerId,
       openedAt: { gte: morningStart },
       status: "OPEN",
     },
     select: { ticker: true, direction: true, qty: true, avgCost: true,
               stopLoss: true, targetPrice: true, analystId: true },
   });

   // Trades closed this morning
   const closedPositions = await prisma.position.findMany({
     where: {
       userId: ownerId,
       closedAt: { gte: morningStart },
       status: "CLOSED",
     },
     select: { ticker: true, direction: true, closePrice: true, avgCost: true,
               outcome: true, agentEvaluation: true, analystId: true },
   });

   // Non-trivial thesis changes (skip REVIEWED — too noisy)
   const thesisChanges = await prisma.thesisUpdate.findMany({
     where: {
       createdAt: { gte: morningStart },
       updateType: { in: ["INVALIDATED", "CLOSED", "UPDATED"] },
       thesis: {
         researchRun: { agentConfigId: { in: analystIds } },
       },
     },
     select: {
       updateType: true,
       notes: true,
       thesis: { select: { ticker: true, direction: true, analystId: true } },
     },
   });
   ```

4. **If nothing happened** (no new positions, no closes, no thesis changes): skip email for that owner.

5. **Send one email per owner** using `dailyRunDigestHtml()`.

### Template: `lib/emails/daily-run-digest.ts` — new file

```ts
export function dailyRunDigestHtml(args: {
  date: string;                    // "Monday, May 11"
  analysts: {
    name: string;
    newTrades: NewTrade[];
    closedTrades: ClosedTrade[];
    thesisChanges: ThesisChange[];
  }[];
}): string
```

**Layout** (dark theme, same as other templates):
```
Morning Run Digest — {date}

━━━ {AnalystName} ━━━━━━━━━━━━━━━━

New positions (2):
  📈 NVDA    10 shares @ $875.40   stop $840  target $950
  📉 TSLA     5 shares @ $175.20   stop $185  target $155

Closed positions (1):
  ✅ AAPL     WIN  +8.4%   held 12 days   thesis complete

Thesis changes (1):
  🔴 MSFT     INVALIDATED — earnings miss, guidance cut

━━━ {Analyst2Name} ━━━━━━━━━━━━━━━━
  No actions taken this morning.

```

Show "No actions taken this morning" if an analyst ran but produced nothing material. If an analyst didn't run at all, omit their section.

**P&L for closed trades:** compute inline: `((closePrice - avgCost) / avgCost) * 100` for LONG; reverse for SHORT. Format as `+8.4%` or `–3.1%`.

### Register the function

Add `dailyRunDigest` to `lib/inngest/functions/index.ts` (or wherever the other crons are exported). Check the pattern used by `weeklyDigest` — same registration.

---

## Config / gating

`AgentConfig.emailAlerts` (boolean, default `true`) already exists and gates both Alert 1 and Alert 3.

No new schema fields needed.

**Once team access is live:** the digest should go to the owner + any EDITOR/VIEWER members. For now, just the owner. Add a `getAccountEmails(ownerId): Promise<string[]>` helper in `lib/auth/effective-user.ts` when team access ships — the digest function can swap from `[ownerEmail]` to `getAccountEmails(ownerId)` in one line.

---

## Test plan

### Alert 1 (trade opened)
- Trigger a paper trade manually via the agent
- Check inbox within 30s
- Verify: ticker, direction, qty, avg cost, stop, target all correct
- Test with `emailAlerts: false` on AgentConfig — confirm no email

### Alert 2 (trade closed)
- Grep for `"trade/closed"` handler, confirm it's registered
- Close a paper position
- Check inbox within 2 min (Inngest processes async)
- Verify: outcome, P&L, days held correct

### Alert 3 (daily run digest)
- After a morning cron run completes, manually invoke `dailyRunDigest` via Inngest dashboard "Invoke" button
- Verify: all this-morning positions and thesis changes appear
- Verify: analysts with no activity are either omitted or show "No actions"
- Verify: zero-action mornings → no email sent (check Inngest function returned early)

---

## Commit shape (suggested)

1. `feat(email): add trade-opened template + hook in place-trade`
2. `fix(email): verify trade-closed handler is registered (or create it)`
3. `feat(email): daily run digest cron + template`

---

## What NOT to touch

- `lib/emails/weekly-digest.ts` — the Sunday digest is separate and complete
- `lib/emails/near-target.ts` — the intraday near-target alert is separate and complete
- `lib/email.ts` — `sendEmail` and `getUserEmail` are correct as-is; don't refactor
- `lib/inngest/functions/trade-evaluator.ts` — post-trade GPT-4o evaluation; out of scope
- `AgentConfig` schema — no new fields needed
