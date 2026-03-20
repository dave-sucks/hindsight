# V2 Phase 2: Brief Restructuring + Decision Persistence + Watchlist Metadata

> **Self-contained implementation guide.** Read this file, then implement. No additional context needed.
> Reference: `docs/v2-architecture.md` for full design rationale.
> **Prerequisite:** Phase 1 must be merged first (buildRunInput, V2 system prompt, tool renames).

## Overview

Phase 2 adds structured data to the brief system, persists all decision types, and enhances watchlist metadata. All schema changes are **additive nullable fields** — zero-risk migrations.

### What Changes
1. **Schema: AnalystBriefing** — add structured fields (watchTomorrow, unresolvedItems, selfCorrections, marketPosture)
2. **Schema: AnalystWatchlistItem** — add triggerCondition, reviewFrequency, addedRunId, lastThesisId
3. **`complete_run` tool** — accepts structured brief fields from the agent
4. **`update-analyst-briefing.ts`** — accepts pre-structured fields, only generates narrative
5. **TradeDecision persistence** — record HOLD, WATCH, REMOVE_WATCH, PASS decisions (not just BUY/SELL)
6. **New UI: DecisionSummaryCard** — renders the Phase 5 decision table
7. **System prompt update** — render structured brief fields in RunInput

---

## Task 2A: Schema Migration — AnalystBriefing

### File: `prisma/schema.prisma`

Add fields to `AnalystBriefing` (line ~317):

```prisma
model AnalystBriefing {
  // ... existing fields (narrative, marketContext, theses, trades, portfolioSnapshot, strategyNotes) ...

  // V2: Structured brief fields — agent produces these directly
  marketPosture     String?       // "cautiously bullish", "defensive", "max long exposure"
  watchTomorrow     Json?         // Array<{symbol, trigger, suggestedAction, priority}>
  unresolvedItems   Json?         // Array<{item, impact, affectedPositions}>
  selfCorrections   Json?         // Array<{observation, adjustment}>
}
```

All fields are nullable → existing rows unaffected.

### Run migration
```bash
npx prisma migrate dev --name add-structured-brief-fields
```

---

## Task 2B: Schema Migration — AnalystWatchlistItem

### File: `prisma/schema.prisma`

Add fields to `AnalystWatchlistItem` (line ~165):

```prisma
model AnalystWatchlistItem {
  // ... existing fields ...

  // V2: Enhanced watchlist metadata
  triggerCondition  String?       // Machine-readable: "price < 145", "RSI < 30", "earnings this week"
  reviewFrequency   String?       // "DAILY" | "WEEKLY" | "ON_CATALYST"
  addedRunId        String?       // Which run added this item
  lastThesisId      String?       // Most recent thesis for this symbol
}
```

### Run migration
```bash
npx prisma migrate dev --name add-watchlist-metadata-fields
```

**Note:** Can combine both migrations into one if done together.

---

## Task 2C: Restructure `complete_run` Tool

### File: `lib/agent/tools.ts`

Find the `complete_run` tool (renamed from `summarize_run` in Phase 1). Currently it accepts:
- `ranked_picks`, `market_summary`, `exposure_breakdown`, `risk_notes`, `overall_assessment`

**Add new parameters:**

```typescript
complete_run: tool({
  description: "Mark run complete with decisions, brief, and portfolio assessment",
  parameters: z.object({
    // Existing fields
    ranked_picks: z.array(z.object({
      rank: z.number(),
      ticker: z.string(),
      direction: z.string(),
      confidence: z.number(),
      reasoning: z.string(),
      action: z.string(),
    })),
    market_summary: z.string(),
    exposure_breakdown: z.object({
      long_exposure: z.number().optional(),
      short_exposure: z.number().optional(),
      net_exposure: z.number().optional(),
    }).optional(),
    risk_notes: z.array(z.string()).optional(),
    overall_assessment: z.string(),

    // NEW: Portfolio review summary (for HOLD decisions)
    portfolio_review: z.string().optional(),

    // NEW: Structured brief fields
    market_posture: z.string().optional(),
    watch_tomorrow: z.array(z.object({
      symbol: z.string(),
      trigger: z.string(),
      suggested_action: z.string(),
      priority: z.enum(["HIGH", "NORMAL"]).optional(),
    })).optional(),
    unresolved_items: z.array(z.object({
      item: z.string(),
      impact: z.string(),
      affected_positions: z.array(z.string()).optional(),
    })).optional(),
    self_corrections: z.array(z.object({
      observation: z.string(),
      adjustment: z.string(),
    })).optional(),
  }),
  execute: async (args) => {
    // ... existing logic (mark COMPLETE, create RunEvents) ...

    // NEW: Pass structured fields to updateAnalystBriefing
    if (analystId) {
      await updateAnalystBriefing({
        analystId,
        runId,
        userId,
        // New structured fields from agent
        structuredBrief: {
          marketPosture: args.market_posture,
          watchTomorrow: args.watch_tomorrow,
          unresolvedItems: args.unresolved_items,
          selfCorrections: args.self_corrections,
        },
      })
    }

    // ... existing return ...
  },
})
```

### Important
- The `complete_run` tool now calls `updateAnalystBriefing` directly (synchronously within the tool execute).
- Remove the `waitUntil(updateAnalystBriefing(...))` call from `agent/route.ts` `onFinish` — briefing is now generated as part of the tool call.
- Keep the `waitUntil` as a FALLBACK only if the agent doesn't call `complete_run` (e.g., step limit hit).

---

## Task 2D: Refactor `update-analyst-briefing.ts`

### File: `lib/agent/update-analyst-briefing.ts`

### Current State
- Called post-run via `waitUntil`
- Loads all context (run events, theses, positions, closed trades, accuracy)
- Calls GPT-4o-mini to generate both narrative AND structured insights
- Stores everything on AnalystBriefing row

### V2 Change
Accept pre-structured fields from the agent. Only generate narrative + strategyNotes via GPT-4o-mini.

**New signature:**
```typescript
interface StructuredBriefInput {
  marketPosture?: string
  watchTomorrow?: Array<{ symbol: string; trigger: string; suggested_action: string; priority?: string }>
  unresolvedItems?: Array<{ item: string; impact: string; affected_positions?: string[] }>
  selfCorrections?: Array<{ observation: string; adjustment: string }>
}

export async function updateAnalystBriefing(params: {
  analystId: string
  runId: string
  userId: string
  structuredBrief?: StructuredBriefInput  // NEW — from complete_run tool
}): Promise<void>
```

**Logic change:**
1. Keep all existing context loading (theses, trades, portfolio snapshot, etc.) — still needed for narrative generation
2. When generating the GPT-4o-mini prompt, INCLUDE the structured fields as context so the narrative references them
3. When creating/updating the AnalystBriefing row, write the structured fields directly:
   ```typescript
   await prisma.analystBriefing.upsert({
     where: { runId },
     create: {
       analystId, runId, userId,
       narrative: generated.narrative,
       strategyNotes: generated.strategyNotes,
       // Existing
       marketContext, theses: thesesData, trades: tradesData, portfolioSnapshot,
       // NEW structured fields from agent
       marketPosture: structuredBrief?.marketPosture ?? null,
       watchTomorrow: structuredBrief?.watchTomorrow ?? null,
       unresolvedItems: structuredBrief?.unresolvedItems ?? null,
       selfCorrections: structuredBrief?.selfCorrections ?? null,
     },
     update: { /* same fields */ },
   })
   ```

---

## Task 2E: Update RunInput to Render Structured Brief

### File: `lib/agent/run-input.ts` (created in Phase 1)

Update the `priorBrief` loading to include structured fields:

```typescript
const latestBriefing = await prisma.analystBriefing.findFirst({
  where: { analystId },
  orderBy: { createdAt: "desc" },
  select: {
    narrative: true,
    strategyNotes: true,
    marketPosture: true,
    watchTomorrow: true,
    unresolvedItems: true,
    selfCorrections: true,
    createdAt: true,
  },
})
```

Update the RunInput type:
```typescript
priorBrief: {
  date: string
  narrative: string
  strategyNotes: string | null
  marketPosture: string | null
  watchTomorrow: Array<{ symbol: string; trigger: string; suggestedAction: string; priority?: string }> | null
  unresolvedItems: Array<{ item: string; impact: string; affectedPositions?: string[] }> | null
  selfCorrections: Array<{ observation: string; adjustment: string }> | null
} | null
```

### File: `lib/agent/system-prompt.ts`

Update Section 5 (Prior Brief) to render structured fields:

```
## Prior Brief ({date})
Market Posture: {marketPosture}

Watch Tomorrow:
- $SYMBOL: {trigger} → {suggestedAction} [PRIORITY]

Unresolved Items:
- {item} — Impact: {impact} — Affects: $SYMBOL1, $SYMBOL2

Self-Corrections:
- Observation: {observation} → Adjustment: {adjustment}

Strategy Notes: {strategyNotes}

Narrative (summary): {first 400 chars of narrative}
```

---

## Task 2F: Expand TradeDecision Persistence

### Current State
`TradeDecision.decision` accepts: "BUY", "SELL", "HOLD", "PASS"
TradeDecision rows are only created by `place_trade` (BUY) and `close_position` (SELL).

### V2 Change
Record ALL decision types. No schema change needed — `decision` is already a String field.

**New values:** "INITIATE", "ADD", "HOLD", "REDUCE", "EXIT", "WATCH", "REMOVE_WATCH", "PASS"

**Where to create TradeDecision rows:**

1. **`place_trade` tool** — already creates BUY. Change to "INITIATE" or "ADD" based on whether position existed.

2. **`close_position` tool** — already creates SELL. Change to "EXIT".

3. **`manage_watchlist` tool** — NEW: create TradeDecision rows:
   ```typescript
   // In manage_watchlist execute, after the watchlist mutation:
   if (runId && analystId) {
     await prisma.tradeDecision.create({
       data: {
         runId, analystId, userId,
         symbol: args.symbol,
         decision: args.action === "ADD" ? "WATCH" : args.action === "REMOVE" ? "REMOVE_WATCH" : "WATCH",
         reasoning: args.reason || args.notes || null,
       },
     })
   }
   ```

4. **`record_thesis` tool** — for PASS decisions:
   ```typescript
   // In record_thesis execute, when direction is PASS:
   if (args.direction === "PASS" && runId && analystId) {
     await prisma.tradeDecision.create({
       data: {
         runId, analystId, userId,
         symbol: args.ticker,
         decision: "PASS",
         reasoning: args.reasoning_summary?.slice(0, 500),
         thesisId: thesis.id,
       },
     })
   }
   ```

5. **`complete_run` tool** — for HOLD decisions (positions not acted on):
   ```typescript
   // For ranked_picks with action "HOLD":
   for (const pick of args.ranked_picks.filter(p => p.action === "HOLD" || p.action === "hold")) {
     // Find the position for this ticker
     const position = await prisma.position.findFirst({
       where: { analystId, symbol: pick.ticker, status: "OPEN" },
     })
     await prisma.tradeDecision.create({
       data: {
         runId, analystId, userId,
         symbol: pick.ticker,
         decision: "HOLD",
         reasoning: pick.reasoning?.slice(0, 500),
         positionId: position?.id,
       },
     })
   }
   ```

---

## Task 2G: DecisionSummaryCard Component

### File: NEW `components/domain/decision-summary-card.tsx`

Renders the decision table from `complete_run` tool output.

**Props** (extracted from `complete_run` args):
```typescript
interface DecisionSummaryCardProps {
  rankedPicks: Array<{
    rank: number
    ticker: string
    direction: string
    confidence: number
    reasoning: string
    action: string
  }>
  marketSummary: string
  exposureBreakdown?: {
    longExposure?: number
    shortExposure?: number
    netExposure?: number
  }
  riskNotes?: string[]
  overallAssessment: string
  portfolioReview?: string
}
```

**Rendering:**
- Use `Card` from ShadCN (`p-6`, same border as all cards)
- Header: "Portfolio Decisions" with badge showing trade count
- Decision table:
  - Columns: # | Ticker | Action | Confidence | Reasoning
  - Action badges color-coded:
    - `text-emerald-500`: INITIATE, ADD
    - `text-muted-foreground`: HOLD, WATCH
    - `text-red-500`: EXIT, REDUCE
    - Default: PASS, REMOVE_WATCH
  - Confidence as colored number (emerald ≥70, yellow 50-69, red <50)
  - Use `tabular-nums` on all numbers
- Exposure row: Long $X | Short $X | Net $X
- Risk notes as bullet list
- Overall assessment as body text

**Design rules from CLAUDE.md:**
- ONLY ShadCN components from /components/ui
- Card with p-6 padding
- All numbers: tabular-nums
- Positive: text-emerald-500
- Negative: text-red-500
- Section headers: text-lg font-medium
- Body: text-sm text-muted-foreground
- NO custom classes on ShadCN components

### Tool UI Registration

In `components/research/AgentThread.tsx`, register for `complete_run`:

The `complete_run` tool UI should render BOTH:
1. `DecisionSummaryCard` (the decision table — new)
2. `RunSummaryCard` (the narrative assessment — existing)

Show DecisionSummaryCard ABOVE RunSummaryCard in the tool result.

---

## Task 2H: Update `manage_watchlist` Tool Parameters

### File: `lib/agent/tools.ts`

Add new optional parameters to the `manage_watchlist` tool:

```typescript
manage_watchlist: tool({
  parameters: z.object({
    // ... existing params ...

    // NEW optional fields
    trigger_condition: z.string().optional()
      .describe("Machine-readable trigger: 'price < 145', 'RSI < 30', 'earnings this week'"),
    review_frequency: z.enum(["DAILY", "WEEKLY", "ON_CATALYST"]).optional()
      .describe("How often to review this item"),
  }),
  execute: async (args) => {
    // ... existing logic ...

    // When creating/updating, include new fields:
    // triggerCondition: args.trigger_condition
    // reviewFrequency: args.review_frequency
    // addedRunId: runId (for ADD action)
  },
})
```

---

## Task 2I: Update `agent/route.ts` — Move Briefing to Tool

### File: `app/api/research/agent/route.ts`

In the `onFinish` callback (around line 409-426), change the briefing logic:

```typescript
// BEFORE (Phase 1):
if (briefingAnalystId) {
  waitUntil(updateAnalystBriefing({ analystId: briefingAnalystId, runId, userId: user.id }))
}

// AFTER (Phase 2):
// Briefing is now generated by complete_run tool directly.
// Only generate as fallback if agent didn't call complete_run (e.g., hit step limit)
const runStatus = await prisma.researchRun.findFirst({
  where: { id: runId },
  select: { status: true },
})
if (runStatus?.status === "RUNNING" && briefingAnalystId) {
  // Agent didn't complete — generate briefing as fallback
  console.warn(`[agent] Run ${runId} still RUNNING after onFinish. Generating fallback briefing.`)
  waitUntil(updateAnalystBriefing({ analystId: briefingAnalystId, runId, userId: user.id }))
}
```

Same change in `morning-research.ts` — briefing should be generated by the tool, with fallback only if the agent doesn't call `complete_run`.

---

## Files Changed Summary

```
EDIT:  prisma/schema.prisma                           (additive fields on AnalystBriefing, AnalystWatchlistItem)
NEW:   prisma/migrations/xxx_v2_phase2/migration.sql  (auto-generated)
EDIT:  lib/agent/tools.ts                             (complete_run accepts brief fields, manage_watchlist new params, TradeDecision creation in record_thesis/manage_watchlist/complete_run)
EDIT:  lib/agent/update-analyst-briefing.ts            (accept structuredBrief input, write structured fields)
EDIT:  lib/agent/run-input.ts                          (load structured brief fields)
EDIT:  lib/agent/system-prompt.ts                      (render structured brief in Section 5)
EDIT:  app/api/research/agent/route.ts                 (move briefing to tool, keep fallback)
EDIT:  lib/inngest/functions/morning-research.ts       (same briefing change)
NEW:   components/domain/decision-summary-card.tsx     (new UI component)
EDIT:  components/research/AgentThread.tsx              (register DecisionSummaryCard for complete_run)
```

---

## Testing Checklist

- [ ] **Migration runs clean:** `npx prisma migrate dev` succeeds, no data loss
- [ ] **Manual agent run:** agent calls `complete_run` with `watch_tomorrow`, `unresolved_items`, `self_corrections`
- [ ] **AnalystBriefing row** has populated `watchTomorrow`, `unresolvedItems`, `selfCorrections` after run
- [ ] **Next run's system prompt** renders structured brief fields (check logs for prompt content)
- [ ] **Agent references prior brief:** during Phase 2/3, agent mentions watchTomorrow triggers
- [ ] **DecisionSummaryCard renders** in the UI for complete_run tool output
- [ ] **TradeDecision rows** created for PASS, WATCH, REMOVE_WATCH, HOLD (not just BUY/SELL)
- [ ] **manage_watchlist** accepts and stores `trigger_condition` and `review_frequency`
- [ ] **Fallback briefing:** if agent hits step limit without calling complete_run, briefing is still generated
- [ ] **Old completed runs replay** correctly (no regression from new tool params)
- [ ] **Morning cron** still works with new briefing flow

---

## Important Constraints

- All schema changes MUST be additive nullable fields — no column renames, no required fields
- DO NOT change existing tool parameter names (only add new optional ones)
- DO NOT modify UI components in `/components/ui/` — only domain components
- Keep backward compat: old briefings without structured fields render gracefully (null checks everywhere)
- Follow CLAUDE.md design rules for DecisionSummaryCard
- The `complete_run` tool must still work if the new optional params are omitted (backward compat with old runs)
