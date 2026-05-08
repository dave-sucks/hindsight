# Podcast — Operations Playbooks

Two scenarios this PoC was designed to support cleanly. Both are
checklists. Both lean on `docs/PODCAST_FILES.md` as the file
inventory — don't duplicate that list here.

---

## Playbook A — Detach podcast from this repo

Use when: scrapping podcasts; Hindsight trading continues without it.

1. **DB.** Run `prisma/migrations/_podcast_teardown.sql`.
   - Section B first (optional purge of orphan podcast rows in
     shared tables — `ResearchRun`, `Monitor`, `Signal`, etc.).
   - Then Section A (drops podcast tables + columns + enums).
2. **Schema.** In `prisma/schema.prisma`, delete:
   - the four podcast models (`Podcast`, `PodcastSegment`,
     `SegmentTranscript`, `Episode`)
   - the two enums (`SegmentTranscriptStatus`, `EpisodeStatus`)
   - the `podcastSegmentId` field + relation + `@@index` on
     `ResearchRun` and on `Monitor`
3. **Prisma.**
   ```
   npx prisma migrate resolve --rolled-back 20260427000000_podcast_phase1
   npx prisma generate
   ```
4. **Delete every PODCAST-NEW file** listed in
   `docs/PODCAST_FILES.md` (whole directories: `app/(root)/podcasts/`,
   `components/podcasts/`, `lib/podcast/`, plus the individual files
   in `lib/agent/tools/`, `lib/actions/`, `components/agent/renderers/`).
5. **Revert SHARED file changes** (each file in `docs/PODCAST_FILES.md`
   SHARED section that has "Extended" in its Notes). Concretely:
   - `lib/agent/modes.ts` — drop `podcast-builder` and
     `podcast-segment-run` from `AgentMode` + `MODES`
   - `lib/agent/tool-context.ts` — drop `podcastSegmentId`
   - `lib/agent/tool-result.ts` — drop `"podcast-config-preview"`
     from `ToolUI`, drop the `suggest_podcast_config` line from
     `inferLegacyUI`
   - `lib/agent/tools/index.ts` — drop podcast tool imports,
     registrations, exports, and the `podcastSegmentId` field on `ToolCtx`
   - `lib/agent/tools/complete-run.ts` — drop the `if
     (ctx.podcastSegmentId)` branch
   - `app/api/agent/[mode]/route.ts` — drop podcast modes from the
     allowlist array, the `podcast-builder` + `podcast-segment-run`
     branches, and the `suggest_podcast_config` registration
   - `components/agent/AgentChat.tsx` — drop `PODCAST_BUILDER_*`
     constants, `PODCAST_SEGMENT_RUN_COMPOSER`,
     `onPodcastConfigSuggested` prop, the `mode === "podcast-segment-run"`
     branch, and the podcast branches in welcome/composer selection
   - `components/agent/ToolCallRow.tsx` — drop the
     `PodcastConfigPreviewRenderer` import + case +
     `inferLoadingUI` line
   - `components/assistant-ui/tool-uis/tool-ui-shared.tsx` — drop
     `onPodcastConfigSuggested` from the callbacks type
   - `app/(root)/runs/page.tsx` — drop `segment` and
     `segmentTranscript` includes, drop `isPodcastSegmentRun` branches
   - `app/(root)/runs/[id]/page.tsx` — same: drop `segment` include
     and `isPodcastSegmentRun` branches; revert `mode` to
     `"research-run"` only
   - `components/Sidebar.tsx` — drop the `PODCASTS_ENABLED` flag
     and its conditional MAIN_NAV entry
6. **Delete the migration directory** `prisma/migrations/20260427000000_podcast_phase1/`
   and the teardown script `prisma/migrations/_podcast_teardown.sql`.
7. **Delete the docs**: `docs/PODCAST_PLAN.md`, `docs/PODCAST_FILES.md`,
   `docs/PODCAST_OPERATIONS.md` (this file).
8. **Verify.** From repo root:
   ```
   grep -rn -l 'podcast\|Podcast\|Segment[A-Z]' app/ components/ lib/ prisma/
   ```
   Should return nothing (or only false positives — check each).
9. **Build.** `npm run build` passes. `/runs` and `/runs/[id]` load.
   Trading analyst run still works end-to-end.

---

## Playbook B — Fork into a podcast-only app

Use when: spinning up a new repo that's just the podcast feature.

1. **Clone the repo to a fresh directory + new git remote.**
2. **Schema.** In `prisma/schema.prisma`, KEEP:
   - `User`, `UserApiKey` (auth + creds — repurpose for ElevenLabs)
   - the four podcast models + enums
   - `Monitor` (drop `analystId` field + relation)
   - `ResearchRun`, `RunEvent`, `RunMessage` (drop `agentConfigId` field
     + relation, drop `briefing`/`theses`/`decisions`/`managementActions`
     relations)
   - `Signal`, `SignalBatch`, `Artifact` (intelligence pipeline reused)

   DELETE every other model — every entry under TRADING-ONLY in
   `docs/PODCAST_FILES.md` "Trading domain models" plus
   `AnalystSignalRoute`, `MorningBrief`, `AnalystBriefing`,
   `AccuracyReport`, `AnalystWatchlistItem`, `WatchlistItem`,
   `Position`, `Order`, `PositionEvent`, `PositionManagementAction`,
   `SyncHealthSnapshot`, `Thesis`, `TradeDecision`, `AgentConfig`.

3. **Delete every TRADING-ONLY file** listed in
   `docs/PODCAST_FILES.md` (full subtrees: `app/(root)/analysts/`,
   `app/(root)/trades/`, `app/(root)/performance/`,
   `app/(root)/intelligence/`, `app/(root)/stocks/`,
   `components/analysts/`, `components/research/`,
   `components/domain/`, `lib/inngest/functions/morning-research.ts`
   and the other trading crons, `lib/alpaca.ts`, `lib/trade-exit.ts`,
   etc).
4. **Strip trading code from SHARED files:**
   - `lib/agent/modes.ts` — keep only `podcast-builder` and
     `podcast-segment-run`. Delete `research-run`, `builder`,
     `editor`, all their prompts and constants.
   - `lib/agent/tools/index.ts` — keep only `read_artifact`,
     `web_search`, `write_segment_transcript`,
     `suggest_podcast_config`, `complete_run`. Delete every other
     tool import/registration/export.
   - `lib/agent/tools/complete-run.ts` — keep the early
     `complete_run` shell + the podcast branch. Delete the
     analyst-briefing block entirely.
   - `app/api/agent/[mode]/route.ts` — keep only `podcast-builder`
     and `podcast-segment-run` branches. Delete the
     `research-run`/`builder`/`editor` branches and everything
     downstream that's analyst-shaped (`buildRunInput`,
     `buildV2SystemPrompt`, `BUILDER_SYSTEM_PROMPT`,
     `buildEditorSystemPrompt`, position lookup, alpacaCreds, etc).
   - `components/agent/AgentChat.tsx` — keep only the
     `podcast-builder` and `podcast-segment-run` branches and their
     constants. Delete `BUILDER_WELCOME`, `EDITOR_WELCOME`,
     `BUILDER_COMPOSER`, `EDITOR_COMPOSER`, the analyst
     `handleConfirmConfig`, the `research-run` tabbed layout, and
     the brief/sources/theses props.
   - `components/agent/ToolCallRow.tsx` — keep `ToolUIRenderer`,
     `AskQuestionRenderer` (podcast-builder uses ask_question), and
     `PodcastConfigPreviewRenderer`. Delete `ThesisCardRenderer`,
     `RunSummaryRenderer`, `ConfigPreviewRenderer`.
   - `lib/agent/tool-context.ts` — drop trading fields
     (`analystId`, `watchlist`, `positionTickers`, `exclusionList`,
     `sectors`, `industries`, `themes`, `marketCapMin/Max`,
     `maxPositionSize`, `maxOpenPositions`, `minConfidence`,
     `alpacaCreds`, `intelligencePolicy`).
   - `lib/agent/tool-result.ts` — drop `thesis-card`, `run-summary`,
     `config-preview` from `ToolUI`. Drop the corresponding lines
     from `inferLegacyUI`/`remapLegacyUi`/`inferLegacyGroupId`.
   - `app/(root)/runs/page.tsx` and `app/(root)/runs/[id]/page.tsx`
     — keep only the podcast branches; drop `agentConfig`/`theses`/
     `decisions`/`managementActions` includes and rendering.
   - `components/Sidebar.tsx` — drop trading nav entries (Analysts,
     Trades, Performance, Intelligence). Keep Dashboard, Runs,
     Podcasts. Remove the `NEXT_PUBLIC_PODCASTS_ENABLED` flag —
     Podcasts is the app, not a feature.
5. **Intelligence pipeline.** Trading-flavored Inngest jobs
   (`firm-market-sweep`, `portfolio-watchlist-monitor`,
   `signal-router`, `morning-brief-generator`) write to the shared
   tables we kept. For Phase 1 the podcast app doesn't need them —
   segments use `web_search` directly. Either delete those crons
   entirely OR neuter them (early `return` in each handler) until
   Phase 4 lands a podcast-aware signal router.
6. **Reset Prisma migration history.**
   - Delete `prisma/migrations/*` entirely.
   - `npx prisma migrate dev --name init` to generate a fresh
     baseline reflecting the podcast-only schema.
   - Apply to the new app's database.
7. **Clean dependencies.** In `package.json`, remove trading-only
   deps: `@alpacahq/alpaca-trade-api`, the SEC EDGAR / FMP /
   Finnhub clients if their import sites are gone. Keep
   `@ai-sdk/openai`, `@ai-sdk/anthropic`, `ai`, `inngest`,
   `@assistant-ui/*`, `@prisma/*`, Supabase, ShadCN deps.
8. **Rewrite `CLAUDE.md`.** Strip the trading sections; keep the
   stack section + agent runtime + tool architecture rules.
   Add the podcast-specific architecture notes (carry over the
   relevant bits from `docs/PODCAST_PLAN.md`).
9. **Verify.**
   ```
   npm run build               # passes
   grep -rn 'analyst\|Analyst\|trade\|Trade\|alpaca' app/ components/ lib/
   # → nothing or only podcast-flavored references
   ```
   Manual smoke test: build a podcast, run a segment, see the
   transcript stream end-to-end.

---

## Notes on both playbooks

- **The teardown SQL never deletes trading data.** Every WHERE
  clause filters on a podcast discriminator. Safe to run on a
  database with trading rows.
- **The forward migration is additive only.** No drops, no
  destructive ALTERs. Safe to apply on a database with existing
  trading data.
- **Layer 2 of the schema is the only subtle bit** — see
  `docs/PODCAST_FILES.md` "Database — what's owned vs what's shared".
  Both playbooks treat shared tables correctly (Playbook A purges
  podcast rows from them; Playbook B keeps the tables but drops
  trading-flavored columns).
