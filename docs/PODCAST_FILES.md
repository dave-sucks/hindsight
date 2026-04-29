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
| `lib/podcast/segment-run-prompt.ts` | System prompt for `podcast-segment-run` mode. Threads the most recent `PodcastSegmentBriefing` into the prompt for cross-episode continuity. |
| `lib/podcast/update-segment-briefing.ts` | Mirror of `lib/agent/update-analyst-briefing.ts`. Reads a run's transcript + run events + 3 most-recent prior briefings, asks GPT-4o-mini for a 200-300 word recap + 0-5 follow-ups, persists as `PodcastSegmentBriefing`. Non-fatal — writes a fallback row on LLM failure. |

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
| `app/(root)/podcasts/[id]/page.tsx` | Podcast detail. Segments live as cards on this page (no separate segment route); the per-segment settings sheet handles all editing. |

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
| `components/podcasts/SegmentConfigForm.tsx` | Segment analog of `AnalystConfigForm` with the same Brief / Monitors / Settings tab structure. Imports primitives directly from `AnalystConfigForm` so the visual language is identical. Monitors tab manages segment search-monitors inline. |
| `components/podcasts/SegmentConfigSheet.tsx` | Mirror of `AnalystConfigSheet` — wraps `SegmentConfigForm` in a Sheet, pipes per-field saves to `updateSegment` / `addSegmentMonitor` / `removeSegmentMonitor`. Takes a `SegmentSummary` (carried inline by `getPodcastDetail`) so opening it is zero-fetch. There is no per-segment page — the sheet IS the segment editor. |
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
| `lib/agent/tools/read-signals.ts` | **Extended.** Branches on `ctx.podcastSegmentId` to query `PodcastSegmentSignalRoute` (segment branch returns the same `SignalsToolData` shape as the analyst branch — buckets everything as discovery since segments don't have positions/watchlist). Re-enabled in `podcast-segment-run` allowlist. |
| `lib/inngest/functions/signal-router.ts` | **Extended.** After the analyst-routing pass, runs a second pass that builds segment profiles from `PodcastSegment` rows and writes `PodcastSegmentSignalRoute` rows for OWNER (signal came from a segment-owned monitor) and TOPIC_MATCH (segment.topics overlap with signal.themes/sectors/industries). `excludeTopics` hard-rejects. Same Signal table feeds both passes. |
| `lib/inngest/functions/domain-monitor.ts` | Reused as-is. Already filters by `type: "DOMAIN"` only — picks up segment-scoped Monitor rows automatically. |
| `lib/inngest/functions/firm-market-sweep.ts` | Reused as-is. Already filters by `type: "SEARCH"` only — picks up segment-scoped Monitor rows automatically. |
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
| `PodcastSegmentSignalRoute` | Mirror of `AnalystSignalRoute`. The segment's intelligence inbox. Written by `signal-router.ts` for OWNER (signal from a segment-owned Monitor) and TOPIC_MATCH routing codes. Read by `read_signals` when `ToolContext.podcastSegmentId` is set. |
| `PodcastSegmentBriefing` | Mirror of `AnalystBriefing`. Per-run recap of what the segment covered + open follow-ups. Written by `lib/podcast/update-segment-briefing.ts` (called from `complete_run`'s segment branch). The route loads the most recent briefing into the system prompt for cross-episode continuity. |

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

---

## Known gaps for Session 1

**Mandate: reuse the existing analyst infra, components, tools, server
actions everywhere. Every gap below has an analyst analog already in
the codebase. The next session must mirror it 1:1 in shape and imports,
only swapping the entity (analyst → podcast/segment) where the data
model legitimately differs. NO parallel rebuilds.**

End state — the user can: open a podcast → run a segment → see the
transcript on every surface where it should be findable → refine the
podcast/segments via chat editor → browse the routed signal inbox →
merge transcripts into an Episode (text-only). See
`docs/PODCAST_PLAN.md` "Session 1 — Build experience completeness"
for the full design discussion.

### Transcript visibility

| File | Action |
|------|--------|
| `lib/actions/podcast.actions.ts` | **Extend `SegmentSummary` + `getPodcastDetail`** to include each segment's most-recent transcript as a `TranscriptRowData`-compatible shape (id, title, plainText, citations, durationSec). |
| `components/podcasts/PodcastDetailClient.tsx` | **Make segment cards open the latest transcript.** Either click-through to the latest TranscriptCard sheet, or "View latest transcript" entry in the 3-dot menu. |
| `components/podcasts/PodcastDetailClient.tsx` | **Replace `RecentTranscriptsRail` static rows with `TranscriptRow`** so the right-rail entries open the same sheet. |

### Editor mode (analyst-parity)

| File | Action |
|------|--------|
| `lib/agent/modes.ts` | **Add `podcast-editor` mode** with allowlist mirroring `editor`: ask_question, web_search, read_knowledge_library, suggest_podcast_config. `hasSuggestConfig: false` (use the podcast-specific tool). |
| `lib/podcast/editor-prompt.ts` | **New file.** `buildPodcastEditorSystemPrompt(currentPodcast, currentSegments)` — mirror of `buildEditorSystemPrompt`. Inject current shape into prompt for refine-by-chat. |
| `app/(root)/podcasts/[id]/edit/page.tsx` | **New page.** Mirror of `/analysts/[id]/edit/page.tsx`. Loads podcast + segments, passes to AgentChat with `mode="podcast-editor"`. |
| `app/(root)/podcasts/[id]/edit/client.tsx` | **New client.** Split layout (chat + side panel) mirroring `/analysts/[id]/edit`'s client. Reuse `PodcastConfigPreview` as the side panel. |
| `lib/actions/podcast.actions.ts` | **Add `updatePodcastFromEditor`** action. Diffs edited shape against current, persists podcast meta + segment add/remove/update + Monitor row reconciliation. Pattern mirrors `updateAnalystFromBuilder`. |
| `app/api/agent/[mode]/route.ts` | **Add `podcast-editor` branch.** Loads current podcast + segments shape, builds system prompt with `buildPodcastEditorSystemPrompt`. |
| `components/podcasts/PodcastDetailClient.tsx` | **Wire the 3-dot Edit menu entry** to `router.push(`/podcasts/${id}/edit`)`. (Header dropdown already has it stubbed; ensure it goes here.) |
| `components/agent/AgentChat.tsx` | **Extend** mode handling for `podcast-editor` — reuse the builder welcome/composer pattern, route `onPodcastConfigSuggested` to the editor's update flow instead of create. |

### Knowledge library

| File | Action |
|------|--------|
| `lib/agent/knowledge/podcast-formats.ts` | **New file.** Mirror of `strategy-archetypes.ts`. Format archetypes ("5-min daily news brief", "30-min interview", "10-min essay", "weekly culture roundup", etc.). Each entry: id, name, tagline, description, recommendedSegmentCount, recommendedEpisodeSeconds, segmentTemplates, defaultMonitorPatterns, hostStyleHints. |
| `lib/agent/tools/read-knowledge-library.ts` | **Extend.** Add `topic: "podcast-format"` branch that reads `podcast-formats.ts` index + per-id detail. Same three-beat usage pattern. |
| `lib/agent/modes.ts` | **Add `read_knowledge_library`** to `podcast-builder` and `podcast-editor` allowlists. |
| `lib/podcast/builder-prompt.ts` | **Update prompt.** Require three-beat playbook selection (browse → ask_question → deep-read → adapt) before `suggest_podcast_config`. Cite specific format archetype in the proposal. |

### Findings / signal inbox

| File | Action |
|------|--------|
| `lib/actions/podcast.actions.ts` | **Add `getPodcastFindings(podcastId)`** — queries `PodcastSegmentSignalRoute` aggregated across all segments of the podcast, joins Signal + Artifact, returns the shape `AnalystFindingsTab` consumes. |
| `components/podcasts/PodcastFindingsTab.tsx` | **New component.** Mirror of `AnalystFindingsTab`. Reuse the same signal-row component from `components/intelligence/signal-feed.tsx` (whatever AnalystFindingsTab uses). |
| `components/podcasts/PodcastDetailClient.tsx` | **Add Findings tab** to the existing `Tabs` (Segments / Episodes / Findings). |

### Cross-segment continuity tool

Today the segment agent only sees its OWN prior briefing as context.
It needs to see what OTHER segments of the same podcast covered in
the last 2-3 days so a Politics segment doesn't double up on what
Sports just mentioned, and follow-up arcs span the show.

| File | Action |
|------|--------|
| `lib/agent/tools/read-past-transcripts.ts` | **New tool.** Args: `lookbackDays` (default 3). Resolve `podcastId` from `ctx.podcastSegmentId` → `PodcastSegment.podcastId`. Query `SegmentTranscript` rows for ALL segments under that podcastId where `createdAt >= now() - lookbackDays`, ordered desc, joined to PodcastSegment for `segment.name`. Return one item per past transcript: `{ title, segmentName, snippet (first ~400 chars of plainText), createdAt }`. UI: `tool-ui` with `data.items[]` of generic-kind rows. Use `defineTool()`. |
| `lib/agent/tools/index.ts` | Register `read_past_transcripts` in `createResearchTools`. |
| `lib/agent/modes.ts` | Add `read_past_transcripts` to `podcast-segment-run` allowlist. |
| `lib/podcast/segment-run-prompt.ts` | Add a Stage 1.5 instruction immediately after `read_signals`: "Call `read_past_transcripts` ONCE to see what THIS PODCAST's segments covered the last 2–3 days. Don't repeat them. Build on follow-ups." |

### Episode assembly (text-only)

User can merge N transcripts into a viewable Episode. Episode model
already exists in the schema; need actions + UI. No audio (Phase 2).

| File | Action |
|------|--------|
| `lib/actions/podcast.actions.ts` | **Add `createEpisodeFromTranscripts(podcastId, transcriptIds[], title?)`** — creates Episode row with ordered `transcriptIds`, derives `title` from podcast name + date if not supplied, computes `durationSec` from sum of constituent transcripts, sets `status: "READY"` (text-only is "ready"; audio path uses ASSEMBLING). |
| `lib/actions/podcast.actions.ts` | **Add `getEpisode(episodeId)`** — returns Episode + ordered SegmentTranscripts (full plainText + citations + segmentName). |
| `lib/actions/podcast.actions.ts` | **Add `listEpisodesForPodcast(podcastId)`** — returns Episode list for the Episodes tab. |
| `app/(root)/podcasts/[id]/episodes/[episodeId]/page.tsx` | **New page.** Loads episode + transcripts. Renders inline using `TickerMarkdown` per segment with section headers (segment name). Reuses `BriefDetailDialog` body layout pattern. |
| `components/podcasts/PodcastDetailClient.tsx` | **Wire the Episodes tab.** Replace the Phase-3 placeholder with a real list of episodes. Each row links to the episode page. |
| `components/podcasts/PodcastDetailClient.tsx` | **Add an "Assemble episode" CTA** on the Episodes tab. Opens a small Dialog: multi-select READY transcripts (checkbox list), reorder via up/down arrows, click Assemble → calls `createEpisodeFromTranscripts`, navigates to the new episode page. |

### Migration deploy reminder

Two migrations from the post-Phase-1 commits need to be applied before
the route works end-to-end:

```bash
npx prisma migrate deploy
```

What they do:

- **`20260427120000_podcast_segment_signal_route`** — adds
  `PodcastSegmentSignalRoute` (mirror of `AnalystSignalRoute`). Required
  for `signal-router` to write segment routes and for `read_signals`
  to query them.
- **`20260427130000_podcast_segment_briefing`** — adds
  `PodcastSegmentBriefing` (mirror of `AnalystBriefing`). Required for
  `complete_run` segment branch to write continuity briefs and the
  route to read prior brief into the system prompt.

Both additive only. Trading data untouched. See `docs/PODCAST_FILES.md`
"Schema teardown" for the full audit and `prisma/migrations/_podcast_teardown.sql`
for the rollback script.

### Defensive fix already in `dcb0494`

- `app/api/agent/[mode]/route.ts` — `podcastSegmentBriefing.findFirst`
  wrapped in try/catch so a missing-table scenario (migration lag during
  deploy) degrades to "no continuity" instead of crashing the run. Real
  fix is still: apply pending migrations before deploying agent code.
