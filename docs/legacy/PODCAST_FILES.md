# Podcast Builder — File & Service Tracking

**This is the source of truth.** Every file used by, shared with, or
intentionally avoided by the podcast feature is listed here. When the
podcast feature eventually forks into its own app, the **PODCAST-NEW**
and **SHARED** rows go with it; the **TRADING-ONLY** rows stay behind.
This doc is what the fork PR's checklist works off of (see
`docs/PODCAST_OPERATIONS.md`).

**Mandatory update rule.** Every PR that touches the podcast feature —
whether it adds a file, extends a SHARED file, or even just changes
behavior in a way that affects what the fork would copy — MUST update
this doc in the same commit. If you're a future session and you find
this doc out of sync with what's actually shipped, fix it BEFORE
starting new work; otherwise the divergence compounds.

Sorting: four categories, in this order.

1. **PODCAST-NEW** — created for the podcast feature, only used by it. Goes with the fork.
2. **SHARED** — exists today, used by both. Either reused as-is or extended with a podcast-aware branch (called out in Notes). Goes with both apps.
3. **TRADING-ONLY** — exists today, used only by trading. Listed for the eventual fork's "delete from podcast app" list.
4. **DEPRECATION-CANDIDATE** — slated for removal when the apps split.

---

## PODCAST-NEW

### Database

| File | Notes |
|------|-------|
| `prisma/schema.prisma` (additions) | New models: `Podcast`, `PodcastSegment`, `SegmentTranscript`, `Episode`, `PodcastSegmentSignalRoute`, `PodcastSegmentBriefing`. Enums `SegmentTranscriptStatus`, `EpisodeStatus`. Two FK columns added on existing tables (`ResearchRun.podcastSegmentId`, `Monitor.podcastSegmentId`) — both nullable, no migration risk. See "Schema teardown" below for the full DB-level audit + rollback SQL. |
| `prisma/migrations/20260427000000_podcast_phase1/migration.sql` | Forward migration #1 — Podcast / PodcastSegment / SegmentTranscript / Episode tables, the two FK columns, both enums. The bulk of the feature schema. Idempotent for a clean DB; safe re-run guards (`IF NOT EXISTS`) are NOT included because Prisma's migration runner is single-shot per directory. |
| `prisma/migrations/20260427120000_podcast_segment_signal_route/migration.sql` | Forward migration #2 — `PodcastSegmentSignalRoute` table (mirror of `AnalystSignalRoute`). Required for `signal-router.ts` to write segment-routed signals and for `read_signals` to read them when `ctx.podcastSegmentId` is set. Shipped in commit `e3fe63a`. |
| `prisma/migrations/20260427130000_podcast_segment_briefing/migration.sql` | Forward migration #3 — `PodcastSegmentBriefing` table (mirror of `AnalystBriefing`). Required for `complete_run`'s segment branch to write continuity briefings and for the `[mode]` route to thread the most-recent briefing into the segment-run prompt. Shipped in commit `3d3f11e`. |
| `prisma/migrations/_podcast_teardown.sql` | Manual rollback script. NOT a real Prisma migration (leading `_` skips the runner). Drops every podcast-owned table + the two FK columns + the enums. Run this + remove the podcast models from `schema.prisma` + `prisma migrate resolve --rolled-back` for each of the three migrations above to fully retire the feature. |

### Agent runtime

| File | Notes |
|------|-------|
| `lib/agent/tools/write-segment-transcript.ts` | Stage 5 equivalent of `record_thesis` for podcast segments. Persists `SegmentTranscript`. |
| `lib/agent/tools/suggest-podcast-config.ts` | Builder/Editor analog of `suggest_config`. Returns `{ podcast, segments[] }`. |
| `lib/agent/tools/read-past-transcripts.ts` | Cross-segment continuity (Session 1). Resolves the parent podcast from `ctx.podcastSegmentId` and returns recent transcripts across ALL segments of THIS podcast so the running segment doesn't double-cover what another segment just ran. Used in segment-run Stage 1.5. |
| `lib/agent/knowledge/podcast-formats.ts` | Craft library (Session 1). Structural format archetypes — `DAILY_NEWS_BRIEF`, `WEEKLY_ROUNDUP`, `INTERVIEW_SHOW`, `ESSAY_AND_ANALYSIS`, `RECAP_AND_REACTION`, `DAILY_TRACKER`, `EXPLAINER_DEEP_DIVE`. Each entry carries segment templates, host-style hints, sourcing playbook, and elicitation questions. NOT a topic catalog — the user's pitch supplies topic + perspective + sources; this library supplies SHAPE. Read by `read_knowledge_library` via `topic:"podcast-format"`. |
| `lib/podcast/builder-prompt.ts` | System prompt for `podcast-builder` mode. Session 1 rewrote it around the three-beat playbook (browse → ask_question → deep-read → adapt) using `read_knowledge_library topic:"podcast-format"`. |
| `lib/podcast/segment-run-prompt.ts` | System prompt for `podcast-segment-run` mode. Threads the most recent `PodcastSegmentBriefing` into the prompt for cross-episode continuity. Session 1 added a Stage 1.5 (`read_past_transcripts` after `read_signals`) and tightened Stage 2 research discipline. |
| `lib/podcast/editor-prompt.ts` | System prompt for `podcast-editor` mode (Session 1). CLASSIFY-FIRST discipline: lane (a) Q&A, lane (b) numeric/cosmetic tweak, lane (c) segment add/remove/restructure within the format, lane (d) format pivot. Each lane dictates the required tool sequence (e.g. format pivots MUST read `podcast-format` library before suggest_podcast_config). Mirror of `buildEditorSystemPrompt` for analysts. |
| `lib/podcast/update-segment-briefing.ts` | Mirror of `lib/agent/update-analyst-briefing.ts`. Reads a run's transcript + run events + 3 most-recent prior briefings, asks GPT-4o-mini for a 200-300 word recap + 0-5 follow-ups, persists as `PodcastSegmentBriefing`. Non-fatal — writes a fallback row on LLM failure. |

### Actions / API

| File | Notes |
|------|-------|
| `lib/actions/podcast.actions.ts` | All podcast/segment/episode/transcript CRUD + run-kicking. Exports `getPodcastList`, `getPodcastDetail` (with `latestTranscript` carried inline per segment — Session 1), `getSegmentTranscript`, `createPodcastFromBuilder`, `updateSegment`, `updatePodcastBasics` (now accepts `voiceId` — Session 2), `updatePodcastVoice` (Session 2), `addSegmentMonitor`, `removeSegmentMonitor`, `deletePodcast`, `runSegment` (creates a `ResearchRun` tied to a segment — server action, not an API route), `updatePodcastFromEditor` (Session 1), `createEpisodeFromTranscripts` / `getEpisode` (now includes `audioUrl` — Session 2) / `listEpisodesForPodcast` (Session 1), `triggerEpisodeAudio` (Session 2 — validates ownership, sets ASSEMBLING, dispatches Inngest event). **Hotfix:** `runSegmentViaInngest(segmentId)` — creates `ResearchRun` with `source: "AGENT"`, fires `podcast/segment.run.requested` Inngest event, returns `{ runId }`. `SegmentSummary` extended with `activeRunId: string \| null` (populated from `runs[0]` — no extra query). |

### Pages

| File | Notes |
|------|-------|
| `app/(root)/podcasts/page.tsx` | Podcast list page. |
| `app/(root)/podcasts/new/page.tsx` | New-podcast builder route. |
| `app/(root)/podcasts/new/client.tsx` | Builder client (mirrors `app/(root)/analysts/new/client.tsx`). |
| `app/(root)/podcasts/[id]/page.tsx` | Podcast detail. Segments live as cards on this page (no separate segment route); the per-segment settings sheet handles all editing. Session 1 also loads `episodes` server-side and passes them into `PodcastDetailClient`. |
| `app/(root)/podcasts/[id]/edit/page.tsx` | Podcast editor route (Session 1). Mirror of `/analysts/[id]/edit/page.tsx`. Server-loads the podcast detail and renders `PodcastEditClient`. |
| `app/(root)/podcasts/[id]/episodes/[episodeId]/page.tsx` | Episode detail page (Session 1). **Session 2:** Added `<audio controls>` player (shown when `episode.audioUrl` is set), "Generate audio" button (shows cost estimate, explicit click required), and ASSEMBLING status. Server-computes char count for cost display; renders `GenerateAudioButton` client component. |

### Components — Podcast surfaces

All components below live in `components/podcasts/` and mirror the
analyst surface 1:1. Podcast detail = analyst detail layout (3-col grid,
header pattern, ChipTabs-style tabs, right rail, floating composer,
config sheet). Settings sheets reuse the analyst form primitives
(`Section`, `FieldGroup`, `RowLabel`, `EnumChipsCombobox`,
`FreeTextChipsCombobox`, `GHOST_INPUT`) — those are exported from
`AnalystConfigForm.tsx` so this surface stays byte-identical to the
analyst surface in look and feel.

| File | Notes |
|------|-------|
| `components/podcasts/PodcastsPageClient.tsx` | Top-level list grid + new-podcast empty state. |
| `components/podcasts/PodcastDetailClient.tsx` | Mirror of `AnalystDetailClient`: 3-col grid, header with stats, tabs (Segments / Episodes / Findings), right-rail with quick-run + recent transcripts, floating composer, `PodcastConfigSheet`. Session 1 added: Episodes tab list + Assemble CTA, Findings tab, "Edit with AI" 3-dot entry routing to `/podcasts/[id]/edit`, segment cards opening latest transcript via `TranscriptDialog`, right-rail `TranscriptRow` rows. **Hotfix:** "Run all" now calls `runSegmentViaInngest` for all enabled segments via `Promise.all` + `router.refresh()` — no navigation, all segments execute in parallel via Inngest. Segment cards show a "View live run" dropdown entry (ExternalLink icon) and an amber "Running now — tap to open" footer button when `activeRunId` is set. |
| `components/podcasts/PodcastConfigSheet.tsx` | Mirror of `AnalystConfigSheet` for podcast-level metadata (name, description, host style, cadence, voice). Reuses `Section` / `FieldGroup` / `RowLabel`. **Session 2:** Voice section now has a live `Select` populated from `getElevenLabsVoices()` — fetched once on sheet open, cached in component state. Falls back to "add ElevenLabs key in Settings" hint when no key is configured. |
| `components/podcasts/SegmentConfigForm.tsx` | Segment analog of `AnalystConfigForm` with the same Brief / Monitors / Settings tab structure. Imports primitives directly from `AnalystConfigForm` so the visual language is identical. Monitors tab manages segment search-monitors inline. |
| `components/podcasts/SegmentConfigSheet.tsx` | Mirror of `AnalystConfigSheet` — wraps `SegmentConfigForm` in a Sheet, pipes per-field saves to `updateSegment` / `addSegmentMonitor` / `removeSegmentMonitor`. Takes a `SegmentSummary` (carried inline by `getPodcastDetail`) so opening it is zero-fetch. There is no per-segment page — the sheet IS the segment editor. |
| `components/podcasts/PodcastConfigPreview.tsx` | Mirror of `AnalystConfigPanel`: same Silk intro + bordered shell + tabs (Brief / Segments / Settings) + bottom Confirm CTA. Used by both `/podcasts/new` (builder) and `/podcasts/[id]/edit` (editor) — Session 1 added `confirmLabel` / `confirmingLabel` props so the editor can render "Apply changes" instead of "Create podcast". |
| `components/podcasts/PodcastEditClient.tsx` | Editor client (Session 1). Mirror of `AnalystEditClient`. Split layout: chat left (`AgentChat mode="podcast-editor"`), `PodcastConfigPreview` right when the AI suggests changes. On confirm, calls `updatePodcastFromEditor`. |
| `components/podcasts/PodcastFindingsTab.tsx` | Findings tab (Session 1). Mirror of `AnalystFindingsTab`. Fetches `/api/intelligence/signals?podcastId=…` and reuses `SignalRow` + `FindingDetailDialog` from `components/intelligence/`. |
| `components/podcasts/AssembleEpisodeDialog.tsx` | Episode assembly dialog (Session 1). Multi-select `READY` / `AUDIO_READY` transcripts via checkboxes, reorder via ↑↓ buttons, optional title input, click Assemble → calls `createEpisodeFromTranscripts` and routes to the new episode page. Text-only Phase 1 — audio assembly is Phase 2. |

### Components — Transcript pipeline + chat renderers

These files exist purely because of the podcast feature. They mirror
analyst-side analogs (Thesis pipeline, ConfigPreviewRenderer) for
podcast surfaces, but live outside `components/podcasts/` because they
hook into the shared chat runtime (renderer slots dispatched by
`ToolCallRow`) and the shared run-page. On a fork, these come with
the podcast app.

| File | Notes |
|------|-------|
| `components/agent/sheets/TranscriptSheet.tsx` | Body + controlled wrapper for the transcript detail surface. `TranscriptSheetBody` renders header strip + meta + plainText with inline numbered citation chips + ordered citation list. Session 1 swapped the wrapper from `Sheet` (slide-in) to `Dialog` (centered, `sm:max-w-3xl`) to match `BriefDetailDialog` / `FindingDetailDialog`. The wrapper export is now `TranscriptDialog`. Shipped in commit `6e76a30`; refactored Sheet→Dialog in Session 1. |
| `components/domain/transcript-card.tsx` | Clickable card surface. Header strip with podcast/segment + duration + status, body with preview + meta. Session 1 swapped the inner `Sheet`/`SheetTrigger` to `Dialog`/`DialogTrigger` so the card opens the same `TranscriptSheetBody` inside a Dialog. Used by `TranscriptCardRenderer`, `TranscriptRow`, and the segment-card "View latest transcript" entry on the podcast detail page. Shipped in commit `6e76a30`. |
| `components/agent/renderers/TranscriptCardRenderer.tsx` | Renderer registered against `ui: "transcript-card"`. Reads `write_segment_transcript` tool-call args + result, builds `TranscriptCardData`, renders `TranscriptCard`. Mirror of `ThesisCardRenderer`. Shipped in commit `6e76a30`. |
| `components/agent/renderers/PodcastConfigPreviewRenderer.tsx` | Renderer registered against `ui: "podcast-config-preview"`. Inline summary card for `suggest_podcast_config` results that fires `onPodcastConfigSuggested` through `ToolUICallbacks` so the right-side `PodcastConfigPreview` panel opens. Mirror of `ConfigPreviewRenderer` for analysts. Shipped in PR #194. |
| `components/ui/transcript-row.tsx` | Compact list row for the run-page Transcript tab and the podcast detail right-rail recent-transcripts list. Click → opens the `TranscriptDialog` via `customTrigger`. Mirror of `ThesisRow`. Shipped in commit `6e76a30`. |

### Audio pipeline (Session 2)

| File | Notes |
|------|-------|
| `lib/podcast/elevenlabs.ts` | ElevenLabs TTS client. `listVoices(apiKey)`, `verifyElevenLabsKey(apiKey)`, `chunkText(text)`, `generateEpisodeAudio(text, voiceId, apiKey)` → `{ audioBuffer, combinedAlignment, durationSec }`. Uses `with-timestamps` endpoint so alignment marks are stored for Session 4 karaoke. `estimateCost(charCount)` at $0.30/1k chars surfaces the cost on the generate button before the user clicks. |
| `lib/supabase/service.ts` | Supabase service-role client (`createServiceClient()`) for server-side storage uploads from Inngest. Uses `SUPABASE_SERVICE_ROLE_KEY` env var. NEVER expose to browser. |
| `components/settings/ElevenLabsKeyForm.tsx` | Settings form for ElevenLabs API key. Mirror of `AlpacaKeyForm` — single field (no secret), Save & Verify calls `saveElevenLabsKey`. Uses `UserApiKey` table with `provider="ELEVENLABS"`. |
| `lib/inngest/functions/episode-tts.ts` | Inngest function triggered by `podcast/episode.tts.requested`. Steps: load episode + transcripts → call ElevenLabs TTS (chunked) → upload MP3 to Supabase Storage (`podcast-audio` bucket, path `{userId}/episodes/{episodeId}.mp3`) → update Episode (audioUrl=signed URL, durationSec, combinedAlignment, status=READY). On error: sets status=FAILED and re-throws for Inngest retry (retries: 2). |
| `app/(root)/podcasts/[id]/episodes/[episodeId]/GenerateAudioButton.tsx` | Client component rendered on the episode page. Shows estimated cost inline on the button. On click calls `triggerEpisodeAudio` server action → shows toast → router.refresh() to reflect ASSEMBLING state. |
| `lib/inngest/functions/podcast-segment-run.ts` | **Hotfix (PR #206).** Inngest function triggered by `podcast/segment.run.requested`. Loads segment + podcast, builds system prompt via `buildPodcastSegmentRunPrompt`, filters tools to the `podcast-segment-run` allowlist, runs `generateText` (AbortSignal 3.5 min — leaves buffer before Inngest step limit), persists RunMessages, safety-guards RUNNING→COMPLETE. Enables "Run all" to fire all segments in parallel server-side with no browser navigation required. `retries: 1`. Pattern mirrors `morning-research.ts` exactly. |

### Phase 3/4 placeholders (NOT yet shipped)

| File | Phase | Notes |
|------|-------|-------|
| `lib/podcast/episode-assembly.ts` | 3 | ffmpeg concat for true multi-file episode assembly. |
| `lib/podcast/cover-art.ts` | 4 | Cover art upload helpers. |

---

## SHARED (reused by podcast — minimal or no changes)

### Agent runtime

| File | Notes |
|------|-------|
| `lib/agent/modes.ts` | **Extended.** Added `podcast-builder`, `podcast-segment-run`, and `podcast-editor` (Session 1) to `AgentMode` and `MODES`. Allowlists: `podcast-builder` adds `read_knowledge_library`; `podcast-segment-run` adds `read_past_transcripts`; `podcast-editor` mirrors `editor` shape. Existing trading modes unchanged. |
| `lib/agent/define-tool.ts` | Reused as-is. |
| `lib/agent/tool-result.ts` | Reused as-is. New tools return `ui: "tool-ui"` or `ui: "transcript-card"` / `ui: "podcast-config-preview"`. |
| `lib/agent/tool-context.ts` | **Extended.** Added optional `podcastSegmentId` field. |
| `lib/agent/tools/index.ts` | **Extended.** Registered `write_segment_transcript`, `read_past_transcripts` (Session 1) in `createResearchTools()`. `suggest_podcast_config` is layered in by the route, not the registry. |
| `lib/agent/tools/complete-run.ts` | **Extended.** Branches on `ctx.podcastSegmentId`: skips `updateAnalystBriefing` for segment runs and instead calls `updateSegmentBriefing` to persist a `PodcastSegmentBriefing` row + writes a `segment_run_complete` event. |
| `lib/agent/tools/read-signals.ts` | **Extended.** Branches on `ctx.podcastSegmentId` to query `PodcastSegmentSignalRoute` (segment branch returns the same `SignalsToolData` shape as the analyst branch — buckets everything as discovery since segments don't have positions/watchlist). |
| `lib/agent/tools/read-knowledge-library.ts` | **Extended (Session 1).** Added `topic:"podcast-format"` branch reading from `lib/agent/knowledge/podcast-formats.ts`. Same three-beat usage pattern (browse index → ask_question → deep-read entry) as the trading archetype branch. Builder/Editor allowlist this tool. |
| `lib/agent/knowledge/index.ts` | **Extended (Session 1).** Re-exports `PODCAST_FORMATS`, `getPodcastFormat`, `podcastFormatIndex`, plus the `PodcastFormat` and `SegmentTemplate` types. |
| `lib/inngest/functions/signal-router.ts` | **Extended.** After the analyst-routing pass, runs a second pass that builds segment profiles from `PodcastSegment` rows and writes `PodcastSegmentSignalRoute` rows for OWNER (signal came from a segment-owned monitor) and TOPIC_MATCH (segment.topics overlap with signal.themes/sectors/industries). `excludeTopics` hard-rejects. Same Signal table feeds both passes. |
| `lib/inngest/functions/domain-monitor.ts` | Reused as-is. Already filters by `type: "DOMAIN"` only — picks up segment-scoped Monitor rows automatically. |
| `lib/inngest/functions/firm-market-sweep.ts` | Reused as-is. Already filters by `type: "SEARCH"` only — picks up segment-scoped Monitor rows automatically. |
| `lib/agent/tools/read-artifact.ts` | Reused as-is. |
| `lib/agent/tools/web-search.ts` | Reused as-is. |
| `lib/agent/tools/discover-signals-for-fence.ts` | Reused. Builder uses it to validate proposed segment topics. |
| `lib/agent/tools/get-stock-data.ts` | Reused — segments may want stock context for finance shows. |
| `lib/agent/tools/ask-question.ts` | Reused — builder + editor use it. |
| `lib/agent/tools/suggest-config.ts` | **Untouched.** Trading-builder only. Podcast builder + editor use `suggest_podcast_config`. |
| `app/api/agent/[mode]/route.ts` | **Extended.** Handles `podcast-builder`, `podcast-segment-run`, and `podcast-editor` modes — system prompt selection, run loading by `podcastSegmentId`, podcast loading by `podcastId` for editor, defensive briefing fetch (try/catch around `podcastSegmentBriefing.findFirst` so a migration-lag scenario degrades to "no continuity" instead of crashing the run). Layers `suggest_podcast_config` into the tools map for both builder and editor (Session 1). **Hotfix:** `onFinish` restructured to handle `podcast-segment-run` alongside `research-run`: message persistence (RunMessages), RUNNING→COMPLETE safety guard, `waitUntil`, and `markRunFailed` error handler all extended. Previously the handler bailed out for all non-`research-run` modes, leaving Inngest-executed segment runs with no persisted messages and stuck in RUNNING status. |
| `app/api/intelligence/signals/route.ts` | **Extended (Session 1).** Accepts `podcastId=` query param. When set, scopes the signals query through `Signal.segmentRoutes` against this podcast's segment ids (after ownership check). Mirror of the existing `analystId=` filter, just routes through `PodcastSegmentSignalRoute` instead of `AnalystSignalRoute`. Used by `PodcastFindingsTab`. |

### Chat / UI

| File | Notes |
|------|-------|
| `components/agent/AgentChat.tsx` | **Extended.** Three new modes routed (`podcast-builder`, `podcast-segment-run`, `podcast-editor` — Session 1). Each gets its own welcome + composer features. `podcast-segment-run` renders a Chat \| Transcript tabbed layout (mirror of research-run's Chat \| Sources \| Theses). `podcast-builder` and `podcast-editor` route the `onPodcastConfigSuggested` callback. New `podcastId` prop is forwarded onto the request body for the route to load the canonical state. |
| `components/agent/ToolCallGroup.tsx` | Reused as-is. |
| `components/agent/ToolCallRow.tsx` | **Extended.** Added `podcast-config-preview` and `transcript-card` cases dispatching to `PodcastConfigPreviewRenderer` and `TranscriptCardRenderer` respectively. |
| `components/agent/renderers/ToolUIRenderer.tsx` | Reused as-is. |
| `components/agent/renderers/AskQuestionRenderer.tsx` | Reused as-is. Used by podcast builder + editor via `ask_question`. |
| `components/RunResearchButton.tsx` | **Extended.** Accepts an optional `podcastSegmentId` so segment runs can be triggered from any future segment-level surface with the same chrome + hasRunning logic the analyst trading runs use. |
| `components/analysts/AnalystConfigForm.tsx` | **Shared primitives now exported** (`Section`, `FieldGroup`, `RowLabel`, `EmptyHint`, `GHOST_INPUT`, `EnumChipsCombobox`, `FreeTextChipsCombobox`). Reused by `SegmentConfigForm`, `SegmentConfigSheet`, `PodcastConfigSheet`, and `PodcastConfigPreview` so podcast UI shares the analyst form's exact visual language. |
| `components/Sidebar.tsx` | **Extended.** Added "Podcasts" entry to `MAIN_NAV`, gated on `NEXT_PUBLIC_PODCASTS_ENABLED`. |

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
| `lib/supabase/service.ts` | **NEW (Session 2).** Service-role client for Inngest audio uploads. See PODCAST-NEW above. |
| `lib/prisma.ts` | Reused as-is. |
| `lib/actions/api-keys.actions.ts` | **Extended (Session 2).** Added `getElevenLabsKeyStatus`, `saveElevenLabsKey`, `deleteElevenLabsKey`, `resolveElevenLabsKey` (called from Inngest), `getElevenLabsVoices` (called from PodcastConfigSheet). Uses the existing `UserApiKey` table with `provider="ELEVENLABS"`. Moved from TRADING-ONLY to SHARED. |

### API routes

| File | Notes |
|------|-------|
| `app/api/inngest/route.ts` | **Extended.** `episodeTts` registered (Session 2). **Hotfix:** `podcastSegmentRun` registered (PR #206). All Inngest function handlers must appear in this list to receive events — missed registrations cause silent event drops. |
| `app/(root)/runs/[id]/page.tsx` | **Shared.** Actively used for podcast segment runs — loads `segment`, `segmentTranscript`, and `segment.podcast` relations alongside the run, and builds the Transcript tab payload from `segmentTranscript`. **Hotfix:** Added `isInngestSegmentRun` guard (`source === "AGENT" && podcastSegmentId != null`) that suppresses `autoStart`, preventing AgentThread from firing a competing browser-side agent while Inngest is already executing the segment server-side. (Moved from TRADING-ONLY.) |

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
- `app/(root)/runs/page.tsx` and `app/(root)/runs/` feed components *(trading-flavored runs index; podcast segment runs surface through `/podcasts/[id]` instead)*
  - **`app/(root)/runs/[id]/page.tsx` is SHARED — see above.** The run detail page is actively used for podcast segment runs.
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
- `lib/actions/api-keys.actions.ts` — **moved to SHARED (Session 2)**: extended with ElevenLabs key functions
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
| `RunEvent` | `segment_run_complete` events | FK to a podcast `ResearchRun` |
| `RunMessage` | The agent's chat history for the run | FK to a podcast `ResearchRun` |
| `Monitor` | Segment domain + search monitors (Sonar queries / Firecrawl crawls) | `podcastSegmentId IS NOT NULL` (`analystId IS NULL`) |
| `Signal` | Stories surfaced by segment monitors. Has a back-relation `segmentRoutes` (PodcastSegmentSignalRoute[]) used by `/api/intelligence/signals?podcastId=…`. | `monitorId` points at a podcast `Monitor`, OR `segmentRoutes` array is non-empty |
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
  `components/podcasts/**`, `lib/actions/podcast.actions.ts`,
  `lib/podcast/**`, or any new podcast-only file anywhere else (e.g.
  the transcript pipeline files in `components/agent/sheets/`,
  `components/agent/renderers/`, `components/domain/`,
  `components/ui/`) → row in PODCAST-NEW.
- Every new podcast-related Prisma migration → row in PODCAST-NEW
  Database.
- Every change to a SHARED file → update its Notes line so future
  readers see what the podcast lens needed. If the SHARED entry
  doesn't exist yet (file was previously TRADING-ONLY), add it to
  SHARED with a fresh row.
- When a trading-only file is touched as a side effect (e.g.
  expanding `MODES` or extending an API route to take a `podcastId`),
  it moves to SHARED and gets a Notes line.
- Schema-side: if a new podcast model is added, also update the Layer
  1 / Layer 2 / Layer 3 schema audit and the migration list in the
  "Migration deploy" section. The teardown SQL must be updated in the
  same commit.
- Whoever opens the fork PR uses this doc as the source of truth for
  what to copy and what to leave behind. If you find this doc out of
  sync with `git ls-files` reality, fix it before doing anything else.

## Operational playbooks

For the two scenarios this PoC was designed to support — detaching
the podcast feature from this repo, or forking into a podcast-only
app — see **`docs/PODCAST_OPERATIONS.md`**. That doc is the
step-by-step checklist; this doc is the file inventory the
checklist points at.

---

## Session 1 — what shipped

End state shipped: the user can build a podcast on any topic, run a
segment, see the transcript on every surface where it should be
findable (chat row, run-page Transcript tab, podcast detail card,
recent rail, episode page), refine the podcast via chat editor, browse
the routed signal inbox, and merge transcripts into an Episode
(text-only — audio is Phase 2). Every workstream below was built by
mirroring an analyst analog 1:1 — no parallel rebuilds.

### A — Run-time pipeline (verified, no code changes)

The post-PR-194 commits (`e3fe63a`, `3d3f11e`, `6e76a30`) had already
closed the monitors → signals → router → routes → read tool → briefing
→ transcript renderer loop. Session 1 verified all paths read correctly
and run against the post-Phase-1 migrations.

### B — Cross-segment continuity tool

| File | Status |
|------|--------|
| `lib/agent/tools/read-past-transcripts.ts` | **NEW.** Resolves `podcastId` from `ctx.podcastSegmentId` and returns last N days of transcripts across every segment of the podcast. UI: `tool-ui` with one generic-kind item per past transcript. |
| `lib/agent/tools/index.ts` | Registered `read_past_transcripts` in `createResearchTools`. |
| `lib/agent/modes.ts` | Added `read_past_transcripts` to `podcast-segment-run` allowlist. |
| `lib/podcast/segment-run-prompt.ts` | Stage 1.5 instruction added: "Call `read_past_transcripts` ONCE… don't repeat, build on follow-ups." |

### C — Transcript visibility from podcast detail

| File | Status |
|------|--------|
| `lib/actions/podcast.actions.ts` | `SegmentSummary` extended with `latestTranscript: TranscriptCardData \| null`. `getPodcastDetail` selects the most-recent transcript per segment and maps it. |
| `components/podcasts/PodcastDetailClient.tsx` | Segment cards open the latest transcript via `TranscriptDialog` from a "View latest transcript" 3-dot entry AND from clicking the footer title. `RecentTranscriptsRail` rebuilt around `TranscriptRow` so right-rail entries open the same Dialog. |

### D — Transcript Dialog refactor (Sheet → Dialog)

Aligned the transcript detail surface with `BriefDetailDialog` /
`FindingDetailDialog` so the brief / signal / transcript detail UX is
consistent.

| File | Status |
|------|--------|
| `components/agent/sheets/TranscriptSheet.tsx` | Wrapper renamed `TranscriptSheet` → `TranscriptDialog`, internals swapped from `Sheet`/`SheetContent` to `Dialog`/`DialogContent` with `sm:max-w-3xl`. `TranscriptSheetBody` export and `formatDuration` export are unchanged. |
| `components/domain/transcript-card.tsx` | Inner trigger swapped from `Sheet`/`SheetTrigger` to `Dialog`/`DialogTrigger`. `customTrigger` API unchanged so `TranscriptRow` works without modification. |

### E — Episode text-only assembly

| File | Status |
|------|--------|
| `lib/actions/podcast.actions.ts` | **NEW** actions: `createEpisodeFromTranscripts(podcastId, transcriptIds, title?)` (validates ownership, derives title + duration, sets status `READY`), `getEpisode(episodeId)` (returns Episode + ordered SegmentTranscripts in publish order), `listEpisodesForPodcast(podcastId)`. |
| `app/(root)/podcasts/[id]/episodes/[episodeId]/page.tsx` | **NEW** page. Renders one section per transcript with `TickerMarkdown` body + per-transcript citation list. Section header = segment name + segment number. |
| `components/podcasts/PodcastDetailClient.tsx` | Episodes tab now renders the real list (cards linking to the episode page) + an "Assemble episode" CTA that opens `AssembleEpisodeDialog`. |
| `components/podcasts/AssembleEpisodeDialog.tsx` | **NEW** dialog. Multi-select ready transcripts via checkboxes, reorder via ↑↓ buttons, optional title input, click Assemble → action → navigate. |
| `app/(root)/podcasts/[id]/page.tsx` | Server-loads `episodes` via `listEpisodesForPodcast` alongside the detail and passes them down. |

### F — Editor mode (`podcast-editor`)

| File | Status |
|------|--------|
| `lib/agent/modes.ts` | Added `podcast-editor` to `AgentMode` and `MODES`. Allowlist: `ask_question`, `read_knowledge_library`, `web_search`, `discover_signals_for_fence`, `suggest_podcast_config`. |
| `lib/podcast/editor-prompt.ts` | **NEW.** `buildPodcastEditorSystemPrompt(currentPodcast, currentSegments)`. CLASSIFY-FIRST discipline with four lanes (Q&A / numeric tweak / segment add-remove-restructure / format pivot). Lane (d) MUST read `read_knowledge_library topic:"podcast-format"` before proposing. |
| `app/api/agent/[mode]/route.ts` | Added `podcast-editor` branch. Re-loads canonical Podcast + Segments + Monitors from the DB so the prompt reflects authoritative state, not a stale client snapshot. Layers `suggest_podcast_config` in for editor too. |
| `lib/actions/podcast.actions.ts` | **NEW** `updatePodcastFromEditor(podcastId, config)` — applies a `SuggestedPodcastConfig` proposal as the full desired state. Updates podcast metadata, matches segments by name (case-insensitive), creates new ones, deletes ones missing from the proposal (cascade-removes their monitors and transcripts). USER-origin monitors survive across editor passes; BUILDER-origin monitors get rebuilt every time. |
| `app/(root)/podcasts/[id]/edit/page.tsx` | **NEW** server page. Server-loads podcast detail and renders `PodcastEditClient`. |
| `components/podcasts/PodcastEditClient.tsx` | **NEW** client. Split layout — chat left, `PodcastConfigPreview` right. Mirror of `AnalystEditClient`. On confirm calls `updatePodcastFromEditor`. |
| `components/agent/AgentChat.tsx` | Mode handling extended for `podcast-editor` (welcome, composer, callbacks). New `podcastId` prop forwarded onto request body. |
| `components/podcasts/PodcastDetailClient.tsx` | Header 3-dot menu now has "Edit with AI" entry routing to `/podcasts/${id}/edit`. |
| `components/podcasts/PodcastConfigPreview.tsx` | Added `confirmLabel` / `confirmingLabel` props so editor renders "Apply changes" instead of "Create podcast". Default labels unchanged. |

### G — Knowledge library: podcast formats

| File | Status |
|------|--------|
| `lib/agent/knowledge/podcast-formats.ts` | **NEW.** Mirror of `strategy-archetypes.ts`. Seven structural archetypes shipped (`DAILY_NEWS_BRIEF`, `WEEKLY_ROUNDUP`, `INTERVIEW_SHOW`, `ESSAY_AND_ANALYSIS`, `RECAP_AND_REACTION`, `DAILY_TRACKER`, `EXPLAINER_DEEP_DIVE`). Each entry has segment templates, host-style hints, sourcing playbook, and elicitation questions. **Topic-agnostic by design** — the library encodes SHAPE; the user's pitch supplies topic + perspective + sources. |
| `lib/agent/knowledge/index.ts` | Re-exports `PODCAST_FORMATS`, `getPodcastFormat`, `podcastFormatIndex` + types. |
| `lib/agent/tools/read-knowledge-library.ts` | Extended `topic` enum with `"podcast-format"`. Index + entry branches mirror the trading archetype branches. |
| `lib/agent/modes.ts` | `read_knowledge_library` allowlisted into `podcast-builder` and `podcast-editor`. |
| `lib/podcast/builder-prompt.ts` | Rewritten around the three-beat playbook (browse format index → ask_question → deep-read chosen format → adapt to user's pitch → suggest_podcast_config). Hard rule: no suggest_podcast_config without reading the library. |
| `lib/podcast/segment-run-prompt.ts` | Stage 2 research discipline tightened (triage signals against segment brief, pick strongest 1–3, stop researching as soon as you can write confidently). |

### H — Findings tab (segment signal inbox)

| File | Status |
|------|--------|
| `app/api/intelligence/signals/route.ts` | Extended with `podcastId=` filter. Resolves the podcast's segment ids (after ownership check) and routes the `where` clause through `Signal.segmentRoutes`. Mirror of the existing `analystId=` filter. |
| `components/podcasts/PodcastFindingsTab.tsx` | **NEW.** Mirror of `AnalystFindingsTab`. Reuses `SignalRow`, `FindingDetailDialog`, `SignalFilters` from `components/intelligence/`. |
| `components/podcasts/PodcastDetailClient.tsx` | Added "Findings" to the tab list (Segments / Episodes / Findings). |

## Out of scope (Session 1 → Session 2+)

- **Audio (ElevenLabs TTS)** — Session 2.
- **Karaoke player + true audio episode assembly** — Session 4 (text-only assembly is in Session 1).
- **Daily auto-run cron** — Session 5.
- **Pre-run morning brief** equivalent for segments — confirmed not wanted.
- **`/intelligence` dashboard surfaces** for podcast monitors/signals/briefs — confirmed not needed.
- **`PodcastSegmentBriefing` UI surface** — agent reads briefings via system prompt for continuity; no user-facing brief view needed.
- **Segment-level individual editor mode** — the podcast-editor handles both podcast meta and segment edits in one chat. Per-segment isolated editor is unnecessary.

## Migration deploy

All three migrations must be applied for the runtime to function:

```bash
npx prisma migrate deploy
```

- **`20260427000000_podcast_phase1`** — owned-tables (`Podcast`, `PodcastSegment`, `SegmentTranscript`, `Episode`), enums, FK columns on `ResearchRun` + `Monitor`. Shipped in PR #194.
- **`20260427120000_podcast_segment_signal_route`** — `PodcastSegmentSignalRoute`. Required for `signal-router` to write segment routes and for `read_signals` to query them. Shipped in commit `e3fe63a`.
- **`20260427130000_podcast_segment_briefing`** — `PodcastSegmentBriefing`. Required for `complete_run` segment branch to write continuity briefs and the route to thread prior brief into the system prompt. Shipped in commit `3d3f11e`.

All additive only. Trading data untouched. See "Schema teardown" above
for the full audit and `prisma/migrations/_podcast_teardown.sql` for
the rollback script.

### Defensive fix (commit `dcb0494`)

`app/api/agent/[mode]/route.ts` wraps `podcastSegmentBriefing.findFirst`
in try/catch so a missing-table scenario (migration lag during deploy)
degrades to "no continuity" instead of crashing the run. Real fix is
still: apply pending migrations before deploying agent code.
