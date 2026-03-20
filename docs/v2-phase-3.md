# V2 Phase 3: Thesis Lifecycle + Deep Schema Improvements

> **Self-contained implementation guide.** Read this file, then implement. No additional context needed.
> Reference: `docs/v2-architecture.md` for full design rationale.
> **Prerequisite:** Phase 1 AND Phase 2 must be merged first.

## Overview

Phase 3 adds thesis lifecycle management — theses become persistent, living documents that track how the agent's view of a stock evolves over time. This is the deepest structural change and requires careful migration.

### What Changes
1. **Schema: Thesis** — add `status`, `parentThesisId`, `invalidatedAt`, `invalidReason` + self-relation
2. **Schema: AnalystWatchlistItem** — add `promotedToPositionId` for graduation tracking
3. **Backfill script** — set correct status on all existing thesis rows
4. **`record_thesis` tool** — lifecycle transitions (SUPERSEDED, INVALIDATED)
5. **`close_position` tool** — mark linked thesis as CLOSED
6. **RunInput active thesis query** — smart loading based on thesis status
7. **System prompt** — render active theses with lifecycle context

---

## Task 3A: Schema Migration — Thesis Lifecycle

### File: `prisma/schema.prisma`

**Add enum and fields to Thesis model (around line 83):**

```prisma
enum ThesisStatus {
  ACTIVE
  INVALIDATED
  CLOSED
  SUPERSEDED
}

model Thesis {
  id               String        @id @default(cuid())
  researchRunId    String
  userId           String
  ticker           String
  source           String        // "AGENT" | "MANUAL"
  direction        String        // "LONG" | "SHORT" | "PASS"
  entryPrice       Float?
  targetPrice      Float?
  stopLoss         Float?
  holdDuration     String        // "DAY" | "SWING" | "POSITION"
  confidenceScore  Int           // 0-100
  reasoningSummary String
  thesisBullets    String[]
  riskFlags        String[]
  signalTypes      String[]
  sector           String?
  sourcesUsed      Json
  modelUsed        String
  fullResearch     Json?
  thoughtTrace     Json?

  // V2: Thesis lifecycle
  status           ThesisStatus  @default(ACTIVE)
  parentThesisId   String?       // Links to prior thesis on same ticker
  invalidatedAt    DateTime?
  invalidReason    String?

  // Relations
  researchRun      ResearchRun   @relation(fields: [researchRunId], references: [id])
  decisions        TradeDecision[]
  parentThesis     Thesis?       @relation("ThesisChain", fields: [parentThesisId], references: [id])
  childTheses      Thesis[]      @relation("ThesisChain")

  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  @@index([researchRunId])
  @@index([userId])
  @@index([ticker])
  @@index([userId, ticker, status])  // NEW: for active thesis lookups
}
```

**Notes:**
- `status` has default `ACTIVE` so all existing rows automatically get ACTIVE status
- Self-relation `ThesisChain` allows thesis → parent → grandparent chains
- New composite index on `(userId, ticker, status)` for efficient active thesis queries

### Run migration
```bash
npx prisma migrate dev --name add-thesis-lifecycle
```

---

## Task 3B: Schema Migration — Watchlist Graduation Tracking

### File: `prisma/schema.prisma`

Add to `AnalystWatchlistItem`:

```prisma
model AnalystWatchlistItem {
  // ... existing fields ...

  // V2 Phase 2 fields (already added):
  // triggerCondition, reviewFrequency, addedRunId, lastThesisId

  // V2 Phase 3: Graduation tracking
  promotedToPositionId  String?   // FK to Position that this watchlist item graduated into
}
```

### Run migration
```bash
npx prisma migrate dev --name add-watchlist-graduation-tracking
```

**Note:** Can combine with 3A into a single migration.

---

## Task 3C: Backfill Script

### File: NEW `scripts/backfill-thesis-status.ts`

This script sets the correct status on all existing thesis rows. Run it ONCE after migration.

```typescript
import { prisma } from "@/lib/prisma"

async function backfillThesisStatus() {
  console.log("Starting thesis status backfill...")

  // 1. PASS theses → INVALIDATED (they were never actionable)
  // Actually no — PASS theses are valid research. They should stay ACTIVE
  // unless their ticker has a newer thesis.
  // Skip PASS for now — they'll naturally get SUPERSEDED when new theses are created.

  // 2. Theses linked to CLOSED positions → CLOSED
  const closedPositionTickers = await prisma.position.findMany({
    where: { status: "CLOSED" },
    select: { symbol: true, analystId: true, closedAt: true },
  })

  let closedCount = 0
  for (const pos of closedPositionTickers) {
    // Find theses for this ticker by this analyst that were created BEFORE the position closed
    const result = await prisma.thesis.updateMany({
      where: {
        ticker: pos.symbol,
        userId: { not: undefined }, // all users
        direction: { not: "PASS" },
        status: "ACTIVE",
        researchRun: { agentConfigId: pos.analystId },
        createdAt: { lte: pos.closedAt ?? new Date() },
      },
      data: { status: "CLOSED" },
    })
    closedCount += result.count
  }
  console.log(`Marked ${closedCount} theses as CLOSED (linked to closed positions)`)

  // 3. Multiple ACTIVE theses on same ticker by same analyst → older ones SUPERSEDED
  // Find all (userId, ticker) pairs with multiple ACTIVE theses
  const duplicates = await prisma.$queryRaw<Array<{ userId: string; ticker: string; cnt: bigint }>>`
    SELECT "userId", "ticker", COUNT(*) as cnt
    FROM "Thesis"
    WHERE "status" = 'ACTIVE' AND "direction" != 'PASS'
    GROUP BY "userId", "ticker"
    HAVING COUNT(*) > 1
  `

  let supersededCount = 0
  for (const dup of duplicates) {
    // Keep the most recent one ACTIVE, mark others SUPERSEDED
    const theses = await prisma.thesis.findMany({
      where: { userId: dup.userId, ticker: dup.ticker, status: "ACTIVE", direction: { not: "PASS" } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    })

    // Skip the first (most recent), mark the rest SUPERSEDED
    if (theses.length > 1) {
      const olderIds = theses.slice(1).map(t => t.id)
      const result = await prisma.thesis.updateMany({
        where: { id: { in: olderIds } },
        data: { status: "SUPERSEDED" },
      })
      supersededCount += result.count
    }
  }
  console.log(`Marked ${supersededCount} theses as SUPERSEDED (older duplicates)`)

  // 4. PASS theses where a newer non-PASS thesis exists for same ticker → SUPERSEDED
  const passTheses = await prisma.thesis.findMany({
    where: { direction: "PASS", status: "ACTIVE" },
    select: { id: true, userId: true, ticker: true, createdAt: true },
  })

  let passSupersededCount = 0
  for (const pass of passTheses) {
    const newerNonPass = await prisma.thesis.findFirst({
      where: {
        userId: pass.userId,
        ticker: pass.ticker,
        direction: { not: "PASS" },
        createdAt: { gt: pass.createdAt },
      },
    })
    if (newerNonPass) {
      await prisma.thesis.update({
        where: { id: pass.id },
        data: { status: "SUPERSEDED" },
      })
      passSupersededCount++
    }
  }
  console.log(`Marked ${passSupersededCount} PASS theses as SUPERSEDED (newer thesis exists)`)

  console.log("Backfill complete!")
}

backfillThesisStatus()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backfill failed:", err)
    process.exit(1)
  })
```

### Run with:
```bash
npx tsx scripts/backfill-thesis-status.ts
```

---

## Task 3D: `record_thesis` Tool — Lifecycle Transitions

### File: `lib/agent/tools.ts`

Find the `record_thesis` tool (renamed from `show_thesis` in Phase 1).

**Add new parameter:**

```typescript
record_thesis: tool({
  parameters: z.object({
    // ... existing params (ticker, direction, confidence, reasoning_summary, etc.) ...

    // NEW: Thesis lifecycle
    parent_thesis_id: z.string().optional()
      .describe("ID of the prior thesis being updated or invalidated. Links thesis chain."),
  }),
  execute: async (args) => {
    // Create the new thesis row (existing logic)
    const thesis = await prisma.thesis.create({
      data: {
        // ... existing fields ...
        parentThesisId: args.parent_thesis_id || null,
        status: "ACTIVE",  // new theses always start ACTIVE
      },
    })

    // NEW: Handle parent thesis lifecycle transition
    if (args.parent_thesis_id) {
      try {
        if (args.direction === "PASS") {
          // PASS on existing thesis → parent is INVALIDATED
          await prisma.thesis.update({
            where: { id: args.parent_thesis_id },
            data: {
              status: "INVALIDATED",
              invalidatedAt: new Date(),
              invalidReason: args.reasoning_summary?.slice(0, 500) || "Thesis invalidated by follow-up research",
            },
          })
        } else {
          // Updated thesis (LONG/SHORT) → parent is SUPERSEDED
          await prisma.thesis.update({
            where: { id: args.parent_thesis_id },
            data: { status: "SUPERSEDED" },
          })
        }
      } catch (err) {
        console.warn(`[record_thesis] Failed to update parent thesis ${args.parent_thesis_id}:`, err)
        // Non-fatal — the new thesis was still created
      }
    }

    // Also: update watchlist item's lastThesisId if applicable
    if (analystId) {
      try {
        await prisma.analystWatchlistItem.updateMany({
          where: { analystId, symbol: args.ticker, status: "ACTIVE" },
          data: { lastThesisId: thesis.id },
        })
      } catch (err) {
        // Non-fatal
      }
    }

    return { /* ... existing return ... */ }
  },
})
```

### System Prompt Update

In the system prompt's Phase 2 (REVIEW HOLDINGS) section, add:

```
When updating a thesis on a position you're reviewing, pass the `parent_thesis_id` from the
active thesis shown in your portfolio above. This creates a thesis chain for tracking how your
view evolved.

Example: If your portfolio shows AAPL with activeThesisId="clxxx123", and you want to update
your thesis, call: record_thesis({ ticker: "AAPL", parent_thesis_id: "clxxx123", ... })
```

---

## Task 3E: `close_position` Tool — Mark Thesis CLOSED

### File: `lib/agent/tools.ts`

Find the `close_position` tool. After successfully closing the position:

```typescript
close_position: tool({
  execute: async (args) => {
    // ... existing close logic ...

    // NEW: Mark linked thesis as CLOSED
    try {
      // Find the most recent ACTIVE thesis for this ticker by this analyst
      const activeThesis = await prisma.thesis.findFirst({
        where: {
          ticker: args.ticker,
          status: "ACTIVE",
          direction: { not: "PASS" },
          researchRun: { agentConfigId: analystId },
        },
        orderBy: { createdAt: "desc" },
      })

      if (activeThesis) {
        await prisma.thesis.update({
          where: { id: activeThesis.id },
          data: { status: "CLOSED" },
        })
      }
    } catch (err) {
      console.warn(`[close_position] Failed to mark thesis CLOSED for ${args.ticker}:`, err)
      // Non-fatal
    }

    return { /* ... existing return ... */ }
  },
})
```

---

## Task 3F: Update RunInput — Active Thesis Query

### File: `lib/agent/run-input.ts`

Replace the current thesis loading (which was added in Phase 1 as a basic query) with a status-aware query:

```typescript
// Active theses = ACTIVE status, linked to open positions or active watchlist items
const openSymbols = openPositions.map(p => p.symbol)
const watchSymbols = watchlistItems.map(w => w.symbol)
const allRelevantSymbols = [...new Set([...openSymbols, ...watchSymbols])]

const activeTheses = allRelevantSymbols.length > 0
  ? await prisma.thesis.findMany({
      where: {
        status: "ACTIVE",
        ticker: { in: allRelevantSymbols },
        researchRun: { agentConfigId: analystId },
      },
      orderBy: { createdAt: "desc" },
      distinct: ["ticker"], // most recent ACTIVE thesis per ticker
      select: {
        id: true,
        ticker: true,
        direction: true,
        confidenceScore: true,
        reasoningSummary: true,
        entryPrice: true,
        targetPrice: true,
        stopLoss: true,
        createdAt: true,
        researchRunId: true,
        status: true,
      },
    })
  : []
```

### Update RunInput type:
```typescript
activeTheses: Array<{
  id: string
  ticker: string
  direction: string
  confidence: number
  reasoningSummary: string
  entryPrice: number | null
  targetPrice: number | null
  stopLoss: number | null
  createdAt: string
  runId: string
  status: string  // always "ACTIVE" in this context
}>
```

### Link theses to positions:
In the position-building loop, use the activeTheses result:
```typescript
for (const pos of positions) {
  const thesis = activeTheses.find(t => t.ticker === pos.symbol)
  if (thesis) {
    pos.activeThesisId = thesis.id
    pos.activeThesisSummary = thesis.reasoningSummary.slice(0, 200)
  }
}
```

---

## Task 3G: Update System Prompt — Active Theses Section

### File: `lib/agent/system-prompt.ts`

After Section 3 (Portfolio) and before Section 4 (Watchlist), add a dedicated Active Theses section if any exist:

```
## Active Theses
These are your current ACTIVE theses. Use parent_thesis_id when updating them.

| Ticker | Direction | Confidence | Entry | Target | Stop | Created | Thesis ID |
|--------|-----------|-----------|-------|--------|------|---------|-----------|
| AAPL   | LONG      | 82%       | $180  | $200   | $170 | 2026-03-19 | clxxx123 |
| CRWD   | LONG      | 71%       | $340  | $380   | $320 | 2026-03-18 | clxxx456 |

Summary per thesis:
- $AAPL (clxxx123): "iPhone 16 cycle driving services revenue upside..."
- $CRWD (clxxx456): "Post-breach recovery, cloud security spending..."

When reviewing a holding, pass the thesis ID as parent_thesis_id to record_thesis to maintain the chain.
```

---

## Task 3H: `place_trade` Tool — Graduation with Position ID

### File: `lib/agent/tools.ts`

In the `place_trade` tool, when graduating a watchlist item, store the position ID:

```typescript
// Existing graduation logic:
// await prisma.analystWatchlistItem.updateMany({
//   where: { analystId, symbol, status: "ACTIVE" },
//   data: { status: "GRADUATED", removedAt: new Date(), removeReason: "Promoted to active position" },
// })

// V2: Add promotedToPositionId
await prisma.analystWatchlistItem.updateMany({
  where: { analystId, symbol: args.ticker, status: "ACTIVE" },
  data: {
    status: "GRADUATED",
    removedAt: new Date(),
    removeReason: "Promoted to active position",
    promotedToPositionId: position.id,  // NEW
  },
})
```

---

## Files Changed Summary

```
EDIT:  prisma/schema.prisma                           (ThesisStatus enum, Thesis lifecycle fields + self-relation, watchlist promotedToPositionId)
NEW:   prisma/migrations/xxx_thesis_lifecycle/        (auto-generated)
NEW:   scripts/backfill-thesis-status.ts              (one-time backfill)
EDIT:  lib/agent/tools.ts                             (record_thesis lifecycle, close_position marks CLOSED, place_trade graduation)
EDIT:  lib/agent/run-input.ts                         (active thesis query with status filter)
EDIT:  lib/agent/system-prompt.ts                     (active theses section, parent_thesis_id instructions)
```

---

## Testing Checklist

- [ ] **Migration runs clean:** `npx prisma migrate dev` succeeds
- [ ] **Backfill runs clean:** `npx tsx scripts/backfill-thesis-status.ts` — check counts make sense
- [ ] **Existing thesis rows** default to ACTIVE status after migration
- [ ] **Thesis chaining:** Agent reviews holding → calls `record_thesis` with `parent_thesis_id` → parent marked SUPERSEDED
- [ ] **Thesis invalidation:** Agent calls `record_thesis` with direction=PASS and `parent_thesis_id` → parent marked INVALIDATED with reason
- [ ] **Position close → thesis CLOSED:** Agent calls `close_position` → linked ACTIVE thesis marked CLOSED
- [ ] **Active thesis injection:** RunInput only loads ACTIVE theses (not CLOSED/SUPERSEDED/INVALIDATED)
- [ ] **System prompt shows thesis table:** Agent sees thesis IDs and uses them as `parent_thesis_id`
- [ ] **Watchlist graduation stores position ID:** `promotedToPositionId` populated on graduated items
- [ ] **No orphaned theses:** After several runs, verify thesis chains are intact (parent → child links)
- [ ] **Replay old runs:** No regression — old theses without status still render
- [ ] **Morning cron works:** Agent sees active theses, creates chains

---

## Important Constraints

- The `ThesisStatus` enum is a NEW enum — Prisma will create it in the migration. All existing rows get `ACTIVE` default.
- Self-relations in Prisma require both sides defined (`parentThesis` + `childTheses`). Both must reference the same relation name `"ThesisChain"`.
- The backfill script is idempotent — safe to run multiple times.
- Thesis lifecycle transitions are **non-fatal** — if the update fails, the new thesis is still created. Log warnings but don't fail the tool.
- `parent_thesis_id` is always optional in `record_thesis` — the agent may not always have one (e.g., first thesis on a new ticker).
- DO NOT delete old theses — they form the history chain. Status changes only.
- Follow all CLAUDE.md rules.

---

## Migration Risk Assessment

**Medium risk.** The main concerns:
1. **Enum creation:** Prisma creates a new PostgreSQL enum type. This is safe but irreversible without manual SQL.
2. **Self-relation:** Adds a nullable FK column (`parentThesisId`). Safe — no data loss.
3. **Backfill correctness:** The script makes assumptions about which theses should be CLOSED/SUPERSEDED. Review the counts after running.
4. **Agent behavior:** The agent needs to correctly use `parent_thesis_id`. If it doesn't, no harm — theses just won't be chained. Monitor logs for a few runs.

**Rollback plan:** All new fields are nullable. If something goes wrong, you can:
1. Set all thesis statuses back to ACTIVE: `UPDATE "Thesis" SET status = 'ACTIVE'`
2. Clear parentThesisId: `UPDATE "Thesis" SET "parentThesisId" = NULL`
3. The enum can stay — it doesn't affect anything if unused
