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
| `prisma/schema.prisma` (additions) | New models: `Podcast`, `PodcastSegment`, `SegmentTranscript`, `Episode`, enums `SegmentTranscriptStatus`, `EpisodeStatus`. Two FK columns added on existing tables (`ResearchRun.podcastSegmentId`, `Monitor.podcastSegmentId`) — both nullable, no migration risk. |

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

| File | Notes |
|------|-------|
| `components/podcasts/PodcastsPageClient.tsx` | Top-level list grid + new-podcast empty state. |
| `components/podcasts/PodcastBuilderClient.tsx` | Builder split layout (chat on left, suggested config on right). |
| `components/podcasts/PodcastDetailClient.tsx` | Tabbed podcast detail. |
| `components/podcasts/SegmentDetailClient.tsx` | Segment detail w/ Run button, run history, transcripts. |
| `components/podcasts/SegmentMonitorEditor.tsx` | Add/remove monitors on a segment. Reuses Monitor model. |
| `components/podcasts/SegmentTranscriptCard.tsx` | Renders a transcript with citations + (Phase 2) audio player. |
| `components/podcasts/PodcastConfigPreview.tsx` | Right-side panel in builder showing suggested podcast + segments before confirm. |

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
| `components/agent/AgentChat.tsx` | **Extended.** Two new modes routed; podcast builder gets its own welcome + composer features. |
| `components/agent/ToolCallGroup.tsx` | Reused as-is. |
| `components/agent/ToolCallRow.tsx` | Reused as-is. New tools render via `ToolUIRenderer`. |
| `components/agent/renderers/ToolUIRenderer.tsx` | Reused as-is. |
| `components/agent/renderers/AskQuestionRenderer.tsx` | Reused as-is. |
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
