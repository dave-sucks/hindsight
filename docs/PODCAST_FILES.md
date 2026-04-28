# Podcast Builder — File & Service Tracking

Source of truth for what's used by the podcast feature, what's
shared with trading, and what's trading-only. When the podcast
feature eventually forks into its own app, the **PODCAST-NEW** and
**SHARED** rows go with it; the **TRADING-ONLY** rows stay behind.

Update this doc every time a file is touched for the podcast
feature. Keep it sorted by the four categories.

Categories:

- **PODCAST-NEW** — created for the podcast feature, only used by it.
- **SHARED** — exists today, used by both. Either reused as-is or
  extended with a podcast-aware branch (called out in Notes).
- **TRADING-ONLY** — exists today, used only by trading. Listed for
  the eventual fork's "delete from podcast app" list.
- **DEPRECATION-CANDIDATE** — slated for removal when the apps split.

---

## PODCAST-NEW

### Database

| File | Notes |
|------|-------|
| `prisma/schema.prisma` (additions) | New models: `Podcast`, `PodcastSegment`, `SegmentTranscript`, `Episode`, enums `SegmentTranscriptStatus`, `EpisodeStatus`. Two FK columns added on existing tables (`ResearchRun.podcastSegmentId`, `Monitor.podcastSegmentId`) — both nullable, no migration risk. See "Schema teardown" below for the full DB-level audit + rollback SQL. |
| `prisma/migrations/20260427000000_podcast_phase1/migration.sql` | Forward migration — the SQL Prisma applies. Idempotent for a clean DB; safe re-run guards (`IF NOT EXISTS`) are NOT included because Prisma's migration runner is single-shot per directory. |
| `prisma/migrations/_podcast_teardown.sql` | Manual rollback script. NOT a real Prisma migration (leading `_` skips the runner). Run this + remove podcast models from schema.prisma + `prisma migrate resolve --rolled-back` to fully retire the feature. |

### Agent runtime

| File | Notes |
|------|-------|
| `lib/agent/tools/write-segment-transcript.ts` | Stage 5 equivalent of `record_thesis` for podcast segments. Persists `SegmentTranscript`. |
| `lib/agent/tools/suggest-podcast-config.ts` | Builder analog of `suggest_config`. Returns `{ podcast, segments[] }`. |
| `lib/podcast/builder-prompt.ts` | System prompt for `podcast-builder` mode. |
| `lib/podcast/segment-run-prompt.ts` | System prompt for `podcast-segment-run` mode. |

### Actions / API

| File | Notes |
|------|-------|
| `lib/actions/podcast.actions.ts` | All podcast/segment CRUD + run-kick server actions. |
| `app/api/podcasts/run-segment/route.ts` | POST endpoint that creates a `ResearchRun` tied to a segment. Mirrors `/api/research/agent-run`. |

### Pages

| File | Notes |
|------|-------|
| `app/(root)/podcasts/page.tsx` | Podcast list page. |
| `app/(root)/podcasts/new/page.tsx` | New-podcast builder route. |
| `app/(root)/podcasts/new/client.tsx` | Builder client (mirrors `app/(root)/analysts/new/client.tsx`). |
| `app/(root)/podcasts/[id]/page.tsx` | Podcast detail (Segments / Episodes / Settings tabs). |
| `app/(root)/podcasts/[id]/segments/[segmentId]/page.tsx` | Segment detail (Runs / Transcripts / Monitors). |

### Components

All components below mirror the analyst surface 1:1. Podcast detail =
analyst detail layout (3-col grid, header pattern, ChipTabs-style tabs,
right rail, floating composer, config sheet). Segment detail uses the
same scaffold. Settings sheets reuse the analyst form primitives
(`Section`, `FieldGroup`, `RowLabel`, `EnumChipsCombobox`,
`FreeTextChipsCombobox`, `GHOST_INPUT`) — those are exported from
`AnalystConfigForm.tsx` so this surface stays byte-identical to the
analyst surface in look and feel.

| File | Notes |
|------|-------|
| `components/podcasts/PodcastsPageClient.tsx` | Top-level list grid + new-podcast empty state. |
| `components/podcasts/PodcastDetailClient.tsx` | Mirror of `AnalystDetailClient`: 3-col grid, header with stats, tabs (Segments / Episodes / Settings), right-rail with quick-run + recent transcripts, floating composer, `PodcastConfigSheet`. |
| `components/podcasts/PodcastConfigSheet.tsx` | Mirror of `AnalystConfigSheet` for podcast-level metadata (name, description, host style, cadence, voice). Reuses `Section` / `FieldGroup` / `RowLabel`. |
| `components/podcasts/SegmentDetailClient.tsx` | Mirror of `AnalystDetailClient` for segments: same 3-col scaffold, breadcrumb + name + stats header, tabs (Snapshot / Transcripts / Runs), right-rail with run history + monitors, `SegmentConfigSheet`. |
| `components/podcasts/SegmentConfigForm.tsx` | Segment analog of `AnalystConfigForm` with the same Brief / Monitors / Settings tab structure. Imports primitives directly from `AnalystConfigForm` so the visual language is identical. Monitors tab manages segment search-monitors inline. |
| `components/podcasts/SegmentConfigSheet.tsx` | Mirror of `AnalystConfigSheet` — wraps `SegmentConfigForm` in a Sheet, pipes per-field saves to `updateSegment` / `addSegmentMonitor` / `removeSegmentMonitor`. |
| `components/podcasts/PodcastConfigPreview.tsx` | Mirror of `AnalystConfigPanel`: same Silk intro + bordered shell + tabs (Brief / Segments / Settings) + bottom Confirm CTA. The right-side panel of `/podcasts/new`. |

### Phase 2/3/4 placeholders (NOT in this PR)

| File | Phase | Notes |
|------|-------|-------|
| `lib/podcast/elevenlabs.ts` | 2 | TTS client + Storage upload. |
| `lib/podcast/episode-assembly.ts` | 3 | ffmpeg concat. |
| `app/(root)/podcasts/[id]/episodes/[episodeId]/page.tsx` | 3 | Karaoke player. |
| `lib/podcast/cover-art.ts` | 4 | Cover art upload helpers. |

---

## SHARED (reused by podcast — minimal or no changes)

### Agent runtime

| File | Notes |
|------|-------|
| `lib/agent/modes.ts` | **Extended.** Added `podcast-builder` and `podcast-segment-run` to `AgentMode` and `MODES`. Existing modes unchanged. |
| `lib/agent/define-tool.ts` | Reused as-is. |
| `lib/agent/tool-result.ts` | Reused as-is. New tools return `ui: "tool-ui"`. |
| `lib/agent/tool-context.ts` | **Extended.** Added optional `podcastSegmentId` field. |
| `lib/agent/tools/index.ts` | **Extended.** Added new tools to `createResearchTools()`. |
| `lib/agent/tools/complete-run.ts` | **Extended.** Branches on `ctx.podcastSegmentId`: skips `updateAnalystBriefing` for segment runs. |
| `lib/agent/tools/read-signals.ts` | **Excluded from podcast-segment-run allowlist (Phase 1).** Signals route to analysts (sectors/industries/themes), not segments — until a segment-aware signal router lands (Phase 4), the segment uses `web_search` for discovery. |
| `lib/agent/tools/read-artifact.ts` | Reused as-is. |
| `lib/agent/tools/web-search.ts` | Reused as-is. |
| `lib/agent/tools/discover-signals-for-fence.ts` | Reused. Builder uses it to validate proposed segment topics. |
| `lib/agent/tools/get-stock-data.ts` | Reused — segments may want stock context for finance shows. |
| `lib/agent/tools/ask-question.ts` | Reused — builder uses it. |
| `lib/agent/tools/suggest-config.ts` | **Untouched.** Trading-builder only. Podcast builder uses `suggest_podcast_config`. |
| `app/api/agent/[mode]/route.ts` | **Extended.** Added handling for the two new modes (system prompt selection, run loading by `podcastSegmentId`). |

### Chat / UI

| File | Notes |
|------|-------|
| `components/agent/AgentChat.tsx` | **Extended.** Two new modes routed; podcast builder gets its own welcome + composer features; podcast-segment-run mode renders a single Thread with podcast-flavored welcome. |
| `components/agent/ToolCallGroup.tsx` | Reused as-is. |
| `components/agent/ToolCallRow.tsx` | **Extended.** Added the `podcast-config-preview` case dispatching to `PodcastConfigPreviewRenderer`. |
| `components/agent/renderers/ToolUIRenderer.tsx` | Reused as-is. |
| `components/agent/renderers/AskQuestionRenderer.tsx` | Reused as-is. Used by podcast builder via `ask_question`. |
| `components/agent/renderers/PodcastConfigPreviewRenderer.tsx` | **PODCAST-NEW.** Inline summary card for `suggest_podcast_config` results + opens the side panel via `onPodcastConfigSuggested`. |
| `components/analysts/AnalystConfigForm.tsx` | **Shared primitives now exported** (`Section`, `FieldGroup`, `RowLabel`, `EmptyHint`, `GHOST_INPUT`, `EnumChipsCombobox`, `FreeTextChipsCombobox`). Reused by `SegmentConfigForm`, `SegmentConfigSheet`, `PodcastConfigSheet`, and `PodcastConfigPreview` so podcast UI shares the analyst form's exact visual language. |
| `components/Sidebar.tsx` | **Extended.** Added "Podcasts" entry to `MAIN_NAV`. |

### Database (existing tables, podcast adds 1 nullable FK)

| File | Notes |
|------|-------|
| `prisma/schema.prisma` (extensions) | `ResearchRun.podcastSegmentId String?` and `Monitor.podcastSegmentId String?` added. Both null for legacy/trading rows. |

### Intelligence pipeline (no changes — segments read whatever's there)

| File | Notes |
|------|-------|
| `lib/inngest/functions/firm-market-sweep.ts` | Reused. Segments can subscribe to firm signals just like analysts. |
| `lib/inngest/functions/portfolio-watchlist-monitor.ts` | Trading-only conceptually but harmless to share infra. |
| `lib/inngest/functions/domain-monitor.ts` | Reused. Segments add Monitor rows that domain-monitor consumes. |
| `lib/inngest/functions/signal-router.ts` | Currently routes to analysts only. Segment routing is Phase 4 — for PoC, segment runs use `read_signals` with explicit topics/sources filters. |
| `lib/intelligence/sonar.ts` | Reused as-is. |
| `lib/intelligence/firecrawl.ts` | Reused as-is. |

### Auth / Storage

| File | Notes |
|------|-------|
| `lib/supabase/server.ts` / `client.ts` | Reused as-is. |
| `lib/prisma.ts` | Reused as-is. |

---

## TRADING-ONLY (untouched, but listed for fork-day)

These files are NOT used by the podcast feature. They are listed
here so the fork can mechanically delete them from the podcast-app
codebase without leaving dead imports.

### Trading domain models

- `prisma/schema.prisma` (trading slice): `Position`, `Order`,
  `Trade*`, `TradeDecision`, `Thesis`, `AccuracyReport`,
  `AnalystBriefing`, `MorningBrief`, `AnalystSignalRoute`,
  `AnalystWatchlistItem`, `WatchlistItem`, `PositionEvent`,
  `PositionManagementAction`, `SyncHealthSnapshot`, `UserApiKey`
  (Alpaca creds), `AgentConfig`.

### Trading agent tools

- `lib/agent/tools/place-trade.ts`
- `lib/agent/tools/close-position.ts`
- `lib/agent/tools/manage-position.ts`
- `lib/agent/tools/manage-watchlist.ts`
- `lib/agent/tools/record-thesis.ts`
- `lib/agent/tools/record-run-summary.ts`
- `lib/agent/tools/get-portfolio-context.ts`
- `lib/agent/tools/get-market-context.ts`
- `lib/agent/tools/get-earnings-data.ts`
- `lib/agent/tools/get-earnings-calendar.ts`
- `lib/agent/tools/get-market-movers.ts`
- `lib/agent/tools/get-options-flow.ts`
- `lib/agent/tools/get-sec-filings.ts`
- `lib/agent/tools/read-morning-brief.ts`
- `lib/agent/tools/read-knowledge-library.ts`
- `lib/agent/tools/read-analyst-inbox-stats.ts`

### Trading pages and components

- `app/(root)/analysts/**`
- `app/(root)/runs/**` *(could be reused for podcast runs in Phase 4 with a header branch — for PoC we link directly to `/runs/[id]` but the page is currently trading-flavored)*
- `app/(root)/trades/**`
- `app/(root)/performance/**`
- `app/(root)/intelligence/**` *(intelligence dashboard — trading lens; podcast would want its own)*
- `app/(root)/stocks/**`
- `components/analysts/**`
- `components/research/**` (run UI, follow-up chat)
- `components/domain/**` (TradeCard, ThesisCard, MarketContextCard, etc.)
- `components/agent/renderers/ThesisCardRenderer.tsx`
- `components/agent/renderers/RunSummaryRenderer.tsx`
- `components/agent/renderers/ConfigPreviewRenderer.tsx` *(used by `suggest_config`; podcast uses generic ToolUIRenderer)*
- `components/agent/sheets/ThesisSheet.tsx`

### Trading actions and lib

- `lib/actions/analyst.actions.ts`
- `lib/actions/portfolio.actions.ts`
- `lib/actions/closeTrade.actions.ts`
- `lib/actions/api-keys.actions.ts` (Alpaca creds — could be repurposed for ElevenLabs in Phase 2)
- `lib/actions/watchlist.actions.ts`
- `lib/alpaca.ts`
- `lib/trade-exit.ts`
- `lib/agent/system-prompt.ts` (trading 6-stage prompt)
- `lib/agent/run-input.ts` (loads portfolio/watchlist for trading runs)
- `lib/agent/update-analyst-briefing.ts`

### Trading crons

- `lib/inngest/functions/morning-research.ts`
- `lib/inngest/functions/price-monitor.ts`
- `lib/inngest/functions/trade-evaluator.ts`
- `lib/inngest/functions/eod-evaluation.ts`
- `lib/inngest/functions/weekly-digest.ts`
- `lib/inngest/functions/accuracy-scorer.ts`

---

## DEPRECATION-CANDIDATE

Empty for now. If we choose to retire any trading-side file because
the podcast lens forces a rewrite, log it here with the reason.

---

## Database — what's owned vs what's shared

The podcast feature is NOT 4 isolated tables. It's 4 podcast-specific
tables PLUS rows interleaved into 6 existing trading-shared tables.
This is the whole point of the design — the agent runtime, signal
infra, and run streaming UI work for podcasts because podcast runs
land in the same `ResearchRun` rows the trading agent uses, just
discriminated by which FK is set.

Read this before any rollback or fork. Three layers:

### Layer 1 — Tables OWNED BY podcasts (drop on rollback)

These hold only podcast data. Always safe to drop on teardown.

| Table | Purpose |
|-------|---------|
| `Podcast` | Show metadata (name, voice, host style, cadence, cover art). |
| `PodcastSegment` | Recurring beat inside a podcast. Has its own prompt, monitors, topic fence. |
| `SegmentTranscript` | One per Run. Transcript text + citations + (Phase 2) audio + alignment. Unique on `runId`. |
| `Episode` | Ordered list of `SegmentTranscript` ids assembled into a listenable episode. Phase 3. |

### Layer 2 — Tables SHARED with trading (interleaved data)

These tables hold rows from BOTH the trading agent and the podcast
agent. Schema is unchanged for trading; the column additions are
nullable so trading queries that don't reference them are unaffected.
On rollback, these tables stay — but they will contain
podcast-origin rows that become orphaned (their discriminator
columns are gone). The teardown script has an optional purge step
for cleaning those up.

| Table | What podcast writes | How to identify podcast rows |
|-------|---------------------|------------------------------|
| `ResearchRun` | One row per segment run | `podcastSegmentId IS NOT NULL` (`agentConfigId IS NULL`) |
| `RunEvent` | `transcript_complete`, `segment_run_complete` events | FK to a podcast `ResearchRun` |
| `RunMessage` | The agent's chat history for the run | FK to a podcast `ResearchRun` |
| `Monitor` | Segment search monitors (Sonar queries) | `podcastSegmentId IS NOT NULL` (`analystId IS NULL`) |
| `Signal` | Stories surfaced by segment monitors | `monitorId` points at a podcast `Monitor` |
| `Artifact` | Articles extracted for podcast research | Reachable via Signal → Monitor chain. May be shared with trading if the same URL was crawled. |

### Layer 3 — Tables NEVER touched by podcasts (trading-only forever)

| Table | Why podcasts don't touch it |
|-------|------------------------------|
| `User`, `WatchlistItem` | App-wide user data, irrelevant. |
| `AgentConfig`, `AnalystWatchlistItem` | Trading analyst entities. Podcasts use Podcast/PodcastSegment instead. |
| `Thesis`, `TradeDecision` | Trading outputs. Podcasts produce SegmentTranscripts instead. |
| `Position`, `Order`, `PositionEvent`, `PositionManagementAction`, `SyncHealthSnapshot` | Alpaca trading state. Excluded from segment-run tool allowlist. |
| `AnalystSignalRoute`, `MorningBrief`, `AnalystBriefing`, `AccuracyReport` | Per-analyst intelligence + briefing. Phase 4 will add podcast briefings as a peer. |
| `SignalBatch` | Batch tracking for signal-router runs. Podcast Phase 1 doesn't run a router; Phase 4 will. |
| `UserApiKey` | Alpaca creds. Phase 2 will repurpose this shape for ElevenLabs. |

### New enums

| Enum | Values |
|------|--------|
| `SegmentTranscriptStatus` | `DRAFT` / `READY` / `SYNTHESIZING` / `AUDIO_READY` / `FAILED` |
| `EpisodeStatus` | `DRAFT` / `ASSEMBLING` / `READY` / `FAILED` |

### New columns on existing tables (additive, nullable)

| Table | Column | Type | FK target | Note |
|-------|--------|------|-----------|------|
| `ResearchRun` | `podcastSegmentId` | `TEXT` (nullable) | `PodcastSegment(id) ON DELETE SET NULL` | Mutually exclusive with `agentConfigId`. The unified agent route picks mode by which FK is populated. |
| `Monitor`     | `podcastSegmentId` | `TEXT` (nullable) | `PodcastSegment(id) ON DELETE CASCADE` | Mutually exclusive with `analystId`. |

Both default to `NULL` for every existing row, so the trading half
sees the schema unchanged at runtime.

### New indexes

Auto-dropped with their parent table:
- `Podcast_userId_idx`
- `PodcastSegment_podcastId_idx`, `PodcastSegment_userId_idx`
- `SegmentTranscript_segmentId_idx`, `SegmentTranscript_userId_idx`
  (the `runId` UNIQUE index comes from the column constraint)
- `Episode_podcastId_idx`, `Episode_userId_idx`

Dropped explicitly during teardown (on existing tables):
- `ResearchRun_podcastSegmentId_idx`
- `Monitor_podcastSegmentId_idx`

### Rollback procedure

The teardown script (`prisma/migrations/_podcast_teardown.sql`)
has TWO sections:

- **Section A** — drop podcast-specific schema (tables, columns, enums).
  Always runs. Layer 2 tables keep their podcast-origin rows but the
  rows become unreachable (discriminator columns are gone) and are
  effectively dead weight.
- **Section B** — purge orphaned podcast rows from Layer 2 tables.
  Commented out by default. Run BEFORE Section A if you want a fully
  clean teardown.

Full procedure:

1. **(Optional, recommended)** Run Section B from the teardown script
   to delete podcast-origin rows from `ResearchRun`, `RunEvent`,
   `RunMessage`, `Monitor`, `Signal`, `Artifact`. Trading rows are
   untouched (the WHERE clauses filter on `podcastSegmentId IS NOT NULL`
   etc.).
2. Run Section A from the teardown script — drops 4 tables, 2 enums,
   2 columns, 2 indexes.
3. Remove the four podcast models + the two FK additions from
   `prisma/schema.prisma`.
4. `npx prisma migrate resolve --rolled-back 20260427000000_podcast_phase1`
5. `npx prisma generate` to refresh the client types.
6. Delete the files listed in PODCAST-NEW.

After step 2 the trading app keeps running with no schema drift.
Steps 3–6 just clean up the codebase.

---

## Feature flag — `NEXT_PUBLIC_PODCASTS_ENABLED`

The Podcasts entry in the left sidebar is gated on
`NEXT_PUBLIC_PODCASTS_ENABLED === "true"`. Default behavior:

- Flag unset / "false" → Podcasts entry is **hidden** in the sidebar.
  Pages still exist; you can navigate to `/podcasts` directly via URL
  to test, but a regular user won't see anything pointing them there.
- Flag set to "true" → Podcasts entry shows up next to Analysts.

This lets you deploy the code + run the migration without exposing
the feature to anyone. Flip the flag in your Vercel env config when
you're ready to test in the live deployment.

The flag is `NEXT_PUBLIC_*` so it bakes into the client bundle —
toggling requires a redeploy. That's intentional for a PoC; we don't
want runtime drift between server and client about whether the
feature exists.

---

## How to keep this doc honest

- Every new file added under `app/(root)/podcasts/**`,
  `components/podcasts/**`, `lib/actions/podcast.actions.ts`, or
  `lib/podcast/**` → row in PODCAST-NEW.
- Every change to a SHARED file → update its Notes line so future
  readers see what the podcast lens needed.
- When a trading-only file is touched as a side effect (e.g.
  expanding `MODES`), it moves to SHARED and gets a Notes line.
- Whoever opens the fork PR uses this doc as the source of truth for
  what to copy and what to leave behind.

## Operational playbooks

For the two scenarios this PoC was designed to support — detaching
the podcast feature from this repo, or forking into a podcast-only
app — see **`docs/PODCAST_OPERATIONS.md`**. That doc is the
step-by-step checklist; this doc is the file inventory the
checklist points at.
