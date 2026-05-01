# Podcast Builder — Plan

A proof-of-concept podcast generator built on top of the Hindsight agent
runtime. The goal is to validate that the analyst/run/monitor/intelligence
infrastructure generalizes to a content domain (podcasts) without forcing
podcasts to pretend to be analysts. The end state for this feature is
its own dedicated app — this PoC is the runway for that fork, so every
new file is tagged in `docs/PODCAST_FILES.md` to keep the eventual
delete list mechanical.

---

## North Star

A user creates a **Podcast** by chatting with an AI builder ("a daily
6-min show on indie game launches, NPR voice, weekly cadence"). The
builder proposes a Podcast plus 3–5 starter **Segments**. Each Segment
has its own prompt, monitors (Sonar searches, domain feeds), and
universe-style fence (topics / sources / exclusions). The user can run
each segment on demand — the same agent runtime that drives a trading
analyst's morning research run instead produces a **Segment
Transcript** (script + citations). N transcripts assemble into an
**Episode** (audio + karaoke alignment, Phase 2/3).

Podcasts and trading analysts coexist. Trading runs untouched. New
top-level surface: `/podcasts`. No bolt-on into `/analysts`.

---

## Mental Model — what's a what

| Trading concept       | Podcast equivalent                                            |
| --------------------- | ------------------------------------------------------------- |
| `AgentConfig`         | `Podcast` + `PodcastSegment` (split — see below)              |
| Universe (sectors…)   | Segment topics / sources / exclusions                         |
| Watchlist             | (omitted for PoC — could become "ongoing story arcs")         |
| Monitor               | `Monitor` reused as-is, FKed to a Segment                     |
| Signal                | `Signal` reused — same shape                                  |
| Artifact              | `Artifact` reused — same shape                                |
| MorningBrief          | (omitted for PoC — Segment runs read raw signals)             |
| Thesis                | `SegmentTranscript` (the run's persisted artifact)            |
| Position              | (no analog — podcasts don't own anything)                     |
| AccuracyReport        | (Phase 4 — listener retention per segment)                    |
| `place_trade`         | `synthesize_segment` (Phase 2 — ElevenLabs TTS)               |
| `complete_run`        | Reused, branches on segment-mode: skip briefing               |
| Episode               | `Episode` — assembled from N SegmentTranscripts (Phase 3)     |

The split that matters: **Podcast** is the container (name, voice,
host style, cover art, cadence). **PodcastSegment** is the runnable
unit — each segment has its own prompt, monitors, universe fence, and
a feed of past Runs. A Podcast → has many Segments → each has many
Runs → each Run produces one Transcript.

---

## Schema additions

All new tables. No destructive changes to existing tables. Two
existing tables get a single nullable FK each so the agent runtime
can attribute a Run/Monitor to a Segment.

```prisma
enum AnalystOwnerType {
  ANALYST
  PODCAST_SEGMENT
}

enum SegmentTranscriptStatus {
  DRAFT          // returned by tool, awaiting any post-processing
  READY          // text-final, audio absent (Phase 1)
  SYNTHESIZING   // TTS in flight (Phase 2)
  AUDIO_READY    // audioUrl + alignment populated
  FAILED
}

enum EpisodeStatus {
  DRAFT
  ASSEMBLING
  READY
  FAILED
}

model Podcast {
  id            String   @id @default(cuid())
  userId        String
  name          String
  description   String?
  hostStyle     String?  // "conversational, NPR-style, dry wit"
  voiceId       String?  // ElevenLabs voice id; null until Phase 2
  coverArtUrl   String?
  cadence       String?  // "DAILY" | "WEEKLY" | "ON_DEMAND" — informational
  enabled       Boolean  @default(true)
  builderPrompt String?  // user's original "make me a podcast about…" message
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  segments      PodcastSegment[]
  episodes      Episode[]

  @@index([userId])
}

model PodcastSegment {
  id              String   @id @default(cuid())
  podcastId       String
  userId          String   // denormalized for fast list queries
  name            String   // "Top Stories", "Deep Dive"
  description     String?
  segmentPrompt   String   // master prompt — analog of AgentConfig.analystPrompt
  targetSeconds   Int      @default(300)
  orderIndex      Int      @default(0)
  enabled         Boolean  @default(true)

  // Universe fence — topics/sources/exclusions
  topics          String[] @default([])
  sources         String[] @default([])  // domain whitelist (firecrawl/sonar hint)
  excludeTopics   String[] @default([])

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  podcast         Podcast              @relation(fields: [podcastId], references: [id], onDelete: Cascade)
  monitors        Monitor[]            @relation("SegmentMonitors")
  runs            ResearchRun[]        @relation("SegmentRuns")
  transcripts    SegmentTranscript[]

  @@index([podcastId])
  @@index([userId])
}

model SegmentTranscript {
  id              String   @id @default(cuid())
  runId           String   @unique
  segmentId       String
  userId          String
  title           String
  plainText       String   @db.Text
  ssml            String?  @db.Text       // null in Phase 1
  citations       Json     // [{ claim, signalId?, artifactId?, url, quote, startChar, endChar }]
  durationSec     Int?
  audioUrl        String?                 // populated in Phase 2
  alignmentJson   Json?                   // populated in Phase 2
  status          SegmentTranscriptStatus @default(READY)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  run             ResearchRun    @relation(fields: [runId], references: [id], onDelete: Cascade)
  segment         PodcastSegment @relation(fields: [segmentId], references: [id], onDelete: Cascade)

  @@index([segmentId])
  @@index([userId])
}

model Episode {
  id                  String   @id @default(cuid())
  podcastId           String
  userId              String
  title               String
  description         String?
  publishedAt         DateTime?
  transcriptIds       String[] @default([])  // ordered SegmentTranscript ids
  audioUrl            String?
  durationSec         Int?
  combinedAlignment   Json?
  status              EpisodeStatus @default(DRAFT)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  podcast             Podcast @relation(fields: [podcastId], references: [id], onDelete: Cascade)

  @@index([podcastId])
  @@index([userId])
}
```

Existing-table additions (single nullable column each):

```prisma
model ResearchRun {
  // ... existing fields
  podcastSegmentId String?
  segment          PodcastSegment? @relation("SegmentRuns", fields: [podcastSegmentId], references: [id], onDelete: SetNull)
  segmentTranscript SegmentTranscript?

  @@index([podcastSegmentId])
}

model Monitor {
  // ... existing fields
  podcastSegmentId String?
  segment          PodcastSegment? @relation("SegmentMonitors", fields: [podcastSegmentId], references: [id], onDelete: Cascade)

  @@index([podcastSegmentId])
}
```

Why this shape:

- **Podcast separated from Segment** because the runnable unit is the
  Segment, not the Podcast. Trying to make Podcast itself runnable
  (the "Podcast IS an AgentConfig" path) would force every Segment to
  be a separate AgentConfig too, and then we'd be hand-waving Podcast
  metadata (voice, cover art) onto AgentConfig fields that don't fit.
- **ResearchRun reused** because the agent runtime — streaming, tool
  calls, message persistence, run lifecycle — is genuinely
  domain-agnostic. A Run with `podcastSegmentId` set is identical in
  shape to a Run with `agentConfigId` set; the route picks tools and
  prompt by which FK is populated.
- **Monitor reused** because the intelligence layer (Sonar searches,
  domain crawls) is exactly what segment producers need.
- **`SegmentTranscript` separate from `Thesis`** because confounding
  them would force a junk shape on both. Theses are tickers + scores;
  transcripts are scripts + citations. Different data, different UI.
- **No `analystOwnerType` discriminator** on ResearchRun — presence of
  `podcastSegmentId` vs `agentConfigId` (mutually exclusive) is the
  discriminator, simpler.

---

## Agent runtime additions

### New modes (`lib/agent/modes.ts`)

```ts
export type AgentMode =
  | "research-run"
  | "builder"
  | "editor"
  | "podcast-builder"     // chat to create a Podcast + Segments
  | "podcast-segment-run"; // run a single Segment to produce a transcript
```

- `podcast-builder`: GPT-4o, maxSteps 25, tools = `ask_question`,
  `web_search`, `discover_signals_for_fence` (reused — segments use
  signals just like analysts), `suggest_podcast_config`. Has its own
  `BUILDER_SYSTEM_PROMPT` analog.
- `podcast-segment-run`: GPT-4o, temperature 0.2, maxSteps 40, tools =
  `read_signals`, `read_artifact`, `web_search`, `get_stock_data`
  (segments may want stock context), plus the segment-specific actions
  `write_segment_transcript` and `complete_run`. **Trading actions
  explicitly excluded** — no `place_trade`, no `record_thesis`, no
  `manage_position`.

### New tools (`lib/agent/tools/`)

- **`write_segment_transcript`** — the Stage 5 equivalent of
  `record_thesis`. Args: `{ title, plainText, ssml?, citations: [...],
  durationSec? }`. Persists a `SegmentTranscript` row, returns a
  `tool-ui` shaped result so the chat shows the transcript inline
  with citation chips. Phase 1 = `READY` status, no TTS.
- **`suggest_podcast_config`** — the builder analog of
  `suggest_config`. Returns `{ podcast: {...}, segments: [...] }`
  shape. Renders via `tool-ui` for PoC; the user confirms by clicking
  a "Create podcast" CTA in chat.

### `complete_run` branch

The existing `complete_run` tool stays the only finalization point.
It already calls `updateAnalystBriefing` for analyst runs; for podcast
segment runs (detected via `ctx.podcastSegmentId`), skip the briefing
block and just write the `run_complete` event. No new tool, no
duplication. (Briefing for podcast segments is a Phase 4 nice-to-have
— "what we covered, what to follow up on next episode" — but not
required for the MVP.)

### `ToolContext` additions

```ts
interface ToolContext {
  // existing fields...
  podcastSegmentId?: string;  // set when running a Segment
}
```

Tools that already exist (read_signals, read_artifact, web_search,
discover_signals_for_fence, get_stock_data) work unchanged. They
don't touch trading-specific fields.

### Renderer surface — DO NOT add a new renderer

Per CLAUDE.md, the renderer surface is intentionally 5 files. The
`write_segment_transcript` tool returns `ui: "tool-ui"` with a
structured `data` envelope; `ToolUIRenderer` shows the transcript
header + a few preview lines + a citation count, and the full
transcript opens via the existing tool-row expand. If we want a
prettier inline transcript card later, we'll add a `transcript-card`
renderer in Phase 4. NOT now.

---

## Pages and routes

```
/podcasts                              → list of podcasts (filtered to user)
/podcasts/new                          → builder chat + suggested-config preview
/podcasts/[id]                         → Podcast detail: Segments | Episodes | Settings
/podcasts/[id]/segments/[segmentId]    → Segment detail: Runs | Transcripts | Monitors
                                          + Run button to kick a run
/runs/[id]                             → existing — reused for segment runs (already
                                          agnostic; only render branch needed if we
                                          want a podcast-flavored header)
```

API routes:

- `/api/podcasts/run-segment` (POST) — body `{ segmentId }`. Server
  action equivalent: validates ownership, creates a `ResearchRun`
  with `podcastSegmentId` set, returns `runId`. Mirrors
  `/api/research/agent-run`.
- `/api/agent/podcast-builder` and `/api/agent/podcast-segment-run`
  — handled by the existing `[mode]` catch-all once the modes are
  registered. No new route file unless prompt-loading specifics
  demand it.

CRUD for Podcasts and Segments lives in
`lib/actions/podcast.actions.ts` (server actions, pattern matches
`lib/actions/analyst.actions.ts`):

- `createPodcastFromBuilder(podcast, segments[])` — used when the
  user confirms `suggest_podcast_config`.
- `getPodcastList()`, `getPodcastDetail(id)`, `getSegmentDetail(id)`.
- `updateSegment(segmentId, patch)`, `addMonitor`, `removeMonitor`.
- `deletePodcast`, `deleteSegment`.

---

## Phased delivery

### Phase 1 — Foundation (initial PR + follow-up commits)

Initial PR shipped:
- Schema + migration (`Podcast`, `PodcastSegment`, `SegmentTranscript`, `Episode`, enums, FKs).
- `podcast-builder` and `podcast-segment-run` modes.
- `write_segment_transcript` + `suggest_podcast_config` tools.
- `complete_run` segment branch.
- `lib/actions/podcast.actions.ts`.
- Pages: `/podcasts`, `/podcasts/new`, `/podcasts/[id]` (segments live as cards on this page; no per-segment route).
- Sidebar nav entry behind `NEXT_PUBLIC_PODCASTS_ENABLED`.

Follow-up commits (`e3fe63a`, `3d3f11e`, `6e76a30`):
- **Signal pipeline reaches segments.** New `PodcastSegmentSignalRoute` model. `signal-router.ts` extended with a segment-routing pass (OWNER + TOPIC_MATCH). `read_signals` branches on `ctx.podcastSegmentId`. `domain-monitor.ts` and `firm-market-sweep.ts` already pick up segment-scoped Monitor rows (filter by Monitor.type only).
- **Briefing continuity for segment runs.** New `PodcastSegmentBriefing` model + `lib/podcast/update-segment-briefing.ts` (mirror of `update-analyst-briefing.ts`). `complete_run` segment branch calls it. Route loads most-recent briefing into the system prompt as continuity context.
- **Transcripts render through their own card+sheet pipeline.** `TranscriptCardRenderer` + `TranscriptCard` + `TranscriptSheetBody` (mirror of ThesisCardRenderer/ThesisCard/ThesisSheet). `TranscriptRow` for list surfaces. `write_segment_transcript` returns `ui: "transcript-card"` with full data. AgentChat renders Chat | Transcript tabs for `podcast-segment-run` mode.
- **`RunResearchButton` extended** to support `podcastSegmentId` — same chrome, same hasRunning logic, available for any future segment-level surface.

**No audio. No episode assembly. No editor mode. Open gaps tracked in Session 1 below.**

### Session 1 — Build experience completeness (SHIPPED)

End state delivered: the user can build a podcast on any topic, run a
segment, see the transcript on every surface where it should be
findable, refine the podcast / segments via chat editor, browse the
routed signal inbox, and merge transcripts into an Episode (text-only
— audio is Phase 2).

The full file-level inventory of what shipped lives in
`docs/PODCAST_FILES.md` "Session 1 — what shipped". Use that as the
source of truth on a fork. The breakdown below is the design discussion
that drove the build.

**Mandate that drove this session (kept here for the fork's record):
reuse the existing analyst infra + patterns + components everywhere.
Do not rebuild what already exists. Earlier sessions had repeatedly
built fake parallel versions of existing infra; that pattern was
forbidden. Every gap below had an analog already implemented for
analysts — matched 1:1 in shape and imports, only swapping the entity
(analyst → podcast/segment) where the data model legitimately differs.**

#### A. Run-time pipeline — already shipped, document it works

These shipped in `e3fe63a`, `3d3f11e`, `6e76a30`. The next session
should NOT rebuild them — just verify they work end-to-end after the
two follow-up migrations are applied:

- `domain-monitor.ts` and `firm-market-sweep.ts` already pick up
  segment-scoped Monitor rows (filter by Monitor.type only)
- `signal-router.ts` writes `PodcastSegmentSignalRoute` rows for
  OWNER + TOPIC_MATCH after the analyst pass
- `read_signals` branches on `ctx.podcastSegmentId`, queries
  `PodcastSegmentSignalRoute`, returns the same `SignalsToolData`
  shape
- `complete_run`'s segment branch writes `PodcastSegmentBriefing`
  via `updateSegmentBriefing`
- Route threads prior briefing into segment-run-prompt as continuity
- `write_segment_transcript` returns `ui: "transcript-card"`;
  `TranscriptCardRenderer` shows it inline in chat
- AgentChat renders Chat | Transcript tabs for `podcast-segment-run`
- `RunResearchButton` accepts `podcastSegmentId`

#### B. Cross-segment continuity — new tool

The agent needs to know what OTHER segments of THIS podcast covered
in the last 2–3 days, so a Politics segment doesn't re-cover what
Sports already mentioned and follow-up arcs span the show.

| File | Action |
|------|--------|
| `lib/agent/tools/read-past-transcripts.ts` | **New tool.** Takes optional `lookbackDays` (default 3). Queries `SegmentTranscript` rows for ALL segments under the same podcast as `ctx.podcastSegmentId`, ordered by `createdAt desc`, returns title + segmentName + plainText snippet (first ~400 chars) + createdAt per row. Use `defineTool()` factory. UI: `tool-ui` with one generic-kind item per past transcript. |
| `lib/agent/tools/index.ts` | Register `read_past_transcripts` in `createResearchTools`. |
| `lib/agent/modes.ts` | Add `read_past_transcripts` to `podcast-segment-run` allowlist. |
| `lib/podcast/segment-run-prompt.ts` | Add a new Stage 1.5 instruction: "Call `read_past_transcripts` after `read_signals` to see what THIS PODCAST's segments covered the last 2–3 days. Don't repeat them. Build on follow-ups." |

#### C. Transcript visibility from podcast detail page

Right now you can ONLY see a transcript via `/runs/[id]` Transcript
tab. The podcast detail page shows segment cards with "1 transcript"
text but the cards/rows aren't clickable. Fix:

| File | Action |
|------|--------|
| `lib/actions/podcast.actions.ts` | **Extend `SegmentSummary`** with `latestTranscript: TranscriptCardData \| null` (id, title, plainText, citations, durationSec, audioUrl, status). Update `getPodcastDetail` to load it via `transcripts: { take: 1, orderBy: { createdAt: "desc" } }` and map. |
| `components/podcasts/PodcastDetailClient.tsx` | **Make `SegmentCard` clickable.** Wrap card surface in the same pattern `TranscriptCard` uses (Sheet/Dialog trigger). Or add a "View latest transcript" entry to the 3-dot menu. Card click should open the transcript surface. |
| `components/podcasts/PodcastDetailClient.tsx` | **Replace `RecentTranscriptsRail` static rows with `TranscriptRow`** — already a clickable component that opens the transcript surface. |

#### D. Reuse the existing brief/signal Dialog pattern for transcripts

Today `TranscriptSheet` uses `Sheet` (slide-in) because I mirrored
`ThesisSheet`. The user has Dialog-based detail surfaces for briefs
(`BriefDetailDialog`) and signals (`FindingDetail`). Align transcripts
with the Dialog pattern:

| File | Action |
|------|--------|
| `components/agent/sheets/TranscriptSheet.tsx` | **Refactor or replace with `components/podcasts/TranscriptDialog.tsx`** that uses the Dialog primitives matching `BriefDetailDialog`. Keep `TranscriptSheetBody` exports for the body content but render in a `<Dialog>`/`<DialogContent>` instead of `<Sheet>`/`<SheetContent>`. Same width, same header pattern, same content layout (header strip → transcript with inline citation chips → ordered citation list). |
| `components/domain/transcript-card.tsx` | **Update** the trigger wrap: was `<Sheet><SheetTrigger>...</SheetTrigger>...</Sheet>`, become `<Dialog><DialogTrigger>...</DialogTrigger>...</Dialog>`. |
| `components/ui/transcript-row.tsx` | Same swap. |
| `components/agent/renderers/TranscriptCardRenderer.tsx` | No change needed — renders TranscriptCard which uses the new Dialog. |

#### E. Episodes — text-only assembly

User can now assemble N transcripts into one viewable Episode. No
audio. The Episode model is already in the schema; need the actions
+ UI.

| File | Action |
|------|--------|
| `lib/actions/podcast.actions.ts` | **Add `createEpisodeFromTranscripts(podcastId, transcriptIds[], title?)`** — creates `Episode` row with ordered `transcriptIds`. Auto-derives `title` from the date + podcast name if not supplied. Sets `status: "READY"` since text-only is "ready" (vs ASSEMBLING for the audio path). Computes `durationSec` from the sum of constituent transcript `durationSec`. |
| `lib/actions/podcast.actions.ts` | **Add `getEpisode(episodeId)`** — returns Episode + ordered SegmentTranscripts (full plainText + citations + segmentName for each). |
| `lib/actions/podcast.actions.ts` | **Add `listEpisodesForPodcast(podcastId)`** — returns Episode list for the Episodes tab. |
| `app/(root)/podcasts/[id]/episodes/[episodeId]/page.tsx` | **New page.** Loads Episode + transcripts, renders inline using the existing `TickerMarkdown` for body + section headers per segment. Reuses `BriefDetailDialog` body layout pattern. |
| `components/podcasts/PodcastDetailClient.tsx` | **Wire the Episodes tab** — replace the current SkeletonCardStack placeholder with a real list. Each episode is a `Card` linking to `/podcasts/[id]/episodes/[episodeId]`. |
| `components/podcasts/PodcastDetailClient.tsx` | **Add an "Assemble episode" CTA** on the Episodes tab. Opens a small dialog: multi-select READY transcripts, drag-reorder via simple up/down arrows, click Assemble → calls `createEpisodeFromTranscripts`, navigates to the new episode page. |

#### F. Editor mode (analyst-parity)

Today podcasts can only be edited via the inline settings sheet on
the detail page. Analysts have a full chat-refine editor at
`/analysts/[id]/edit`. Mirror it.

| File | Action |
|------|--------|
| `lib/agent/modes.ts` | Add `podcast-editor` mode. Allowlist mirrors `editor`: `ask_question`, `web_search`, `read_knowledge_library`, `read_signals`, `read_past_transcripts`, `suggest_podcast_config`. |
| `lib/podcast/editor-prompt.ts` | **New file.** `buildPodcastEditorSystemPrompt(currentPodcast, currentSegments)` — mirror of `buildEditorSystemPrompt`. CLASSIFY-FIRST discipline (numeric tweak / segment add / fence change / format pivot). Lane (b) freezes brief verbatim, etc. — same shape as analyst editor. |
| `app/(root)/podcasts/[id]/edit/page.tsx` | **New page.** Loads current podcast detail server-side. |
| `app/(root)/podcasts/[id]/edit/client.tsx` | **New client.** Mirror of `app/(root)/analysts/[id]/edit/client.tsx`. Split layout: chat left, `PodcastConfigPreview` panel right. Reuses `AgentChat` with `mode="podcast-editor"`, `currentConfig` carrying podcast + segments. |
| `lib/actions/podcast.actions.ts` | **Add `updatePodcastFromEditor(podcastId, edits)`** — diffs against current. Persists podcast meta. For segments: adds/removes/updates rows. For monitors: reconciles Monitor rows under each segment (mirrors what `updateAnalystFromBuilder` does for domain + search monitors). |
| `app/api/agent/[mode]/route.ts` | Add `podcast-editor` branch — load current shape, build system prompt with `buildPodcastEditorSystemPrompt`, expose `suggest_podcast_config` for the update flow. |
| `components/podcasts/PodcastDetailClient.tsx` | The 3-dot Edit menu entry on the header dropdown should `router.push(\`/podcasts/${id}/edit\`)`. |
| `components/agent/AgentChat.tsx` | Extend mode handling for `podcast-editor` — same welcome/composer pattern as `podcast-builder`, route `onPodcastConfigSuggested` to the editor's update flow instead of create. |

#### G. Knowledge library — podcast-format archetypes

The podcast builder is currently making up formats from scratch every
session. Analysts have `read_knowledge_library` reading
`strategy-archetypes.ts`. Mirror.

| File | Action |
|------|--------|
| `lib/agent/knowledge/podcast-formats.ts` | **New file.** Mirror of `strategy-archetypes.ts`. Format archetypes: `daily-news-brief` (5min), `weekly-roundup` (20min), `interview-show` (30min), `essay-and-analysis` (10min), `culture-watch` (10min), etc. Each entry: `{ id, name, tagline, description, recommendedSegmentCount, recommendedEpisodeSeconds, segmentTemplates: [{name, segmentPrompt, targetSeconds, topics, defaultDomainMonitors, defaultSearchQueries}], hostStyleHints, defaultCadence }`. |
| `lib/agent/tools/read-knowledge-library.ts` | **Extend.** Add `topic: "podcast-format"` branch reading `podcast-formats.ts`. Same three-beat usage pattern (browse list → ask_question → deep-read). |
| `lib/agent/modes.ts` | Add `read_knowledge_library` to `podcast-builder` and `podcast-editor` allowlists. |
| `lib/podcast/builder-prompt.ts` | **Update prompt.** Require three-beat playbook selection (`read_knowledge_library` topic:"podcast-format" → `ask_question` to pick → deep-read chosen format → adapt to user's pitch → `suggest_podcast_config`). Cite the chosen format archetype in the proposal's segments. |

#### H. Findings tab — segment signal inbox

PodcastSegmentSignalRoute rows now exist; need a UI surface to browse.

| File | Action |
|------|--------|
| `lib/actions/podcast.actions.ts` | **Add `getPodcastFindings(podcastId)`** — queries `PodcastSegmentSignalRoute` for all segments of the podcast, joins to Signal + Artifact, returns the same shape `getRunSourcesData`/AnalystFindingsTab consumes. |
| `components/podcasts/PodcastFindingsTab.tsx` | **New component.** Mirror of `AnalystFindingsTab`. Render with the same signal-row component the analyst tab uses (likely `components/intelligence/signal-feed.tsx`). |
| `components/podcasts/PodcastDetailClient.tsx` | **Add Findings tab** to the existing tabs (Segments / Episodes / Findings). |

#### Out of scope for Session 1 (V2+, confirmed)

- **Pre-run morning brief** equivalent for segments — confirmed not wanted.
- **Daily auto-run cron** — V2 (Session 5).
- **Audio (ElevenLabs TTS)** — Session 2.
- **Karaoke player + true audio episode assembly** — Session 4 (text-only assembly is in Session 1).
- **`/intelligence` dashboard surfaces** for podcast monitors/signals/briefs — confirmed not needed.
- **`PodcastSegmentBriefing` UI surface** — agent reads briefings via system prompt for continuity; no user-facing brief view needed.
- **Segment-level individual editor mode** — the Session 1 podcast-editor handles both podcast meta and segment edits in one chat. Per-segment isolated editor is unnecessary.

#### Migration deploy (run before testing)

```bash
npx prisma migrate deploy
```

Applies all pending migrations, including the two from this session
(`20260427120000_podcast_segment_signal_route`,
`20260427130000_podcast_segment_briefing`). See PODCAST_FILES.md
"Schema teardown" for the full migration audit.

### Session 2 — Audio (ElevenLabs TTS) — SHIPPED

End state delivered: the user can pick a voice on the podcast config sheet,
click "Generate audio" on any episode page (which shows the estimated cost
before they click), and land an MP3 on the episode page to press play.

Audio is episode-level (one file per episode, covering all segments in
order). There is no per-segment audio file. One voice per podcast.

#### New files (PODCAST-NEW)

| File | Notes |
|------|-------|
| `lib/podcast/elevenlabs.ts` | ElevenLabs client — voice list, TTS with timestamps (alignment marks for Session 4 karaoke), text chunking at ~5 000 chars per request, `generateEpisodeAudio` wraps chunked calls and returns `{ audioBuffer, combinedAlignment, durationSec }`. Cost estimate at $0.30/1 k chars. |
| `lib/supabase/service.ts` | Service-role Supabase client for Inngest storage uploads (no user session available). Bucket: `podcast-audio`. Path: `{userId}/episodes/{episodeId}.mp3`. Signed URL (7 days) stored as `Episode.audioUrl`. |
| `components/settings/ElevenLabsKeyForm.tsx` | Mirror of `AlpacaKeyForm`. Single API key field (ElevenLabs has no secret). Provider: `"ELEVENLABS"`. Save & Verify calls ElevenLabs `/user` endpoint. |
| `lib/inngest/functions/episode-tts.ts` | Inngest function `episode-tts`. Event: `podcast/episode.tts.requested`. Steps: load → TTS → Storage upload → update Episode. On error: sets status=FAILED and re-throws for retry (retries: 2). |
| `app/(root)/podcasts/[id]/episodes/[episodeId]/GenerateAudioButton.tsx` | Client component. Shows `~$X.XX` cost on button face. On click: `triggerEpisodeAudio` → toast → `router.refresh()`. Re-generate variant shown below the audio player. |

#### SHARED files extended

| File | What Session 2 added |
|------|---------------------|
| `lib/actions/api-keys.actions.ts` | `getElevenLabsKeyStatus`, `saveElevenLabsKey`, `deleteElevenLabsKey`, `resolveElevenLabsKey` (for Inngest), `getElevenLabsVoices` (for voice picker). Moved from TRADING-ONLY to SHARED. |
| `lib/actions/podcast.actions.ts` | `updatePodcastVoice`, `voiceId` param on `updatePodcastBasics`, `audioUrl` on `EpisodeDetail` + `getEpisode`, `triggerEpisodeAudio`. |
| `components/podcasts/PodcastConfigSheet.tsx` | Voice section: live `Select` from `getElevenLabsVoices()`, fetched once on sheet open and cached in component state. |
| `app/(root)/podcasts/[id]/episodes/[episodeId]/page.tsx` | `<audio controls>` player, `GenerateAudioButton` with char count, ASSEMBLING status label. |
| `app/(root)/settings/page.tsx` | `ElevenLabsKeyForm` added under API Keys section alongside `AlpacaKeyForm`. |
| `app/api/inngest/route.ts` | `episodeTts` registered. |

#### Infrastructure prerequisites (required before first audio generation)

- Create `podcast-audio` bucket in Supabase Storage (private, no public access).
- Set `SUPABASE_SERVICE_ROLE_KEY` env var in Vercel (the service client needs it).
- ElevenLabs API key in Settings → API Keys before using the voice picker or generating audio.

#### Out of scope (Session 2 → later)

- Karaoke player using `combinedAlignment` — Session 4.
- Per-podcast cron auto-generate — Session 5.
- RSS feed, cover art — Session 5.

### Session 3 — Iterate on script + voice quality

Tuning session. No scope until Session 2's first segment audio lands.

### Session 4 — Phase 3: Episode assembly + karaoke

[Same scope — ffmpeg concat, Episode CRUD, karaoke player using combined alignment JSON.]

### Session 5 — Phase 4: Crons + polish

- Daily auto-run cron per podcast (mirror of `morning-research.ts`)
- RSS feed export
- Cover art upload (manual + DALL-E stretch)

---

## Phased delivery (legacy structure — superseded by sessions above)

Outcome: a user can create a podcast, see segments, run a segment,
read its transcript with citations.

### Phase 2 — Audio (next session)

- `lib/podcast/elevenlabs.ts` — TTS client + Supabase Storage upload.
- `synthesize_segment` tool (or extend `write_segment_transcript`'s
  post-processing) to call ElevenLabs and populate `audioUrl` +
  `alignmentJson` on the SegmentTranscript.
- Audio player on the segment detail page.
- Voice picker in the podcast builder.

### Phase 3 — Episode assembly

- `lib/podcast/episode-assembly.ts` — ffmpeg concat over an ordered
  set of transcript audio files.
- Episode CRUD + assembly trigger (manual button on podcast detail).
- `/podcasts/[id]/episodes/[episodeId]` — karaoke player using the
  combined alignment JSON, citation chips fading in as the play head
  enters their `[startChar, endChar]` range.

### Phase 4 — Polish

- Cover art upload.
- Per-podcast "standup" briefing (analog of `updateAnalystBriefing`)
  that gives continuity between episodes.
- RSS feed generation.
- Listener analytics integration if/when we publish anywhere.

---

## Deploy & rollback safety

Phase 1 is built to be **safe to deploy and easy to undo**:

- **All schema additions are additive.** Four new tables + two new
  enums + two nullable FK columns on existing tables. No drops, no
  backfills, no destructive ALTERs. Trading rows get `NULL` for the
  new FKs and the trading code never reads them.
- **Forward migration**:
  `prisma/migrations/20260427000000_podcast_phase1/migration.sql`.
  Applied automatically by `prisma migrate deploy`.
- **Rollback script**: `prisma/migrations/_podcast_teardown.sql` —
  runnable manually against the database. Drops every table, column,
  enum, and index this feature added. Trading data is untouched.
  Procedure documented in `docs/PODCAST_FILES.md` "Rollback procedure".
- **Sidebar feature flag**: `NEXT_PUBLIC_PODCASTS_ENABLED`. The
  Podcasts entry only appears when this is `"true"`. With the flag
  off, code is deployed but the surface is hidden — you can navigate
  to `/podcasts` directly via URL to smoke-test without exposing it
  to anyone else. Flip the flag in Vercel env when ready to ship.

The PoC runtime contract: even with the feature flag on, no podcast
code runs unless a user actively visits `/podcasts/*` or kicks a
segment run. There is no cron, no background job, no auto-run, no
trading-tool intersection. Worst case (flag on, podcast routes
crash): trading stays green.

---

## Open decisions deferred

These are decisions the user has not yet locked in; PoC defaults
chosen are listed here so the eventual app split has a clear record.

| Decision                              | PoC default                          |
| ------------------------------------- | ------------------------------------ |
| Voice provider                        | ElevenLabs (Phase 2)                 |
| Episode assembly trigger              | Manual button (Phase 3)              |
| Cover art                             | Manual upload to Supabase Storage    |
| Trading-tool access for segments      | NO (`place_trade` etc. excluded)     |
| `read_signals` for segments           | YES (intelligence pipeline reused)   |
| `get_stock_data` for segments         | YES (lets stock-news shows research) |
| Briefing for segment runs             | NO in Phase 1, YES in Phase 4        |
| Podcast type discriminator on User    | None — separate tables, separate FKs |

---

## Reuse vs new — one-line summary

**Reused:** ResearchRun, RunEvent, RunMessage, Monitor, Signal,
Artifact, AgentChat (mode-driven), `/api/agent/[mode]` route,
`/api/intelligence/signals` route, ToolCallGroup, ToolCallRow,
ToolUIRenderer, AskQuestionRenderer, all read-side intelligence tools,
`complete_run`, `define-tool` factory, `tool-result` envelope,
`signal-router` (with a podcast-routing pass appended), `domain-monitor`
+ `firm-market-sweep` crons, `RunResearchButton`, `SignalRow` +
`FindingDetailDialog` + `SignalFilters`, `TickerMarkdown`, Sidebar
shell, AnalystConfigForm primitives.

**New (cumulative across PR #194 + post-merge follow-ups + Session 1):**
Six podcast-owned tables (Podcast, PodcastSegment, SegmentTranscript,
Episode, PodcastSegmentSignalRoute, PodcastSegmentBriefing), three
agent modes (`podcast-builder`, `podcast-segment-run`, `podcast-editor`),
four podcast-specific tools (`write_segment_transcript`,
`suggest_podcast_config`, `read_past_transcripts`, plus the
`podcast-format` branch of `read_knowledge_library`), the podcast
craft library (`lib/agent/knowledge/podcast-formats.ts`),
`lib/actions/podcast.actions.ts`, `lib/podcast/builder-prompt.ts` /
`segment-run-prompt.ts` / `editor-prompt.ts` /
`update-segment-briefing.ts`, the transcript pipeline
(`TranscriptCardRenderer` + `TranscriptCard` + `TranscriptSheet` /
`TranscriptDialog` + `TranscriptRow`), the podcast surfaces in
`components/podcasts/` (`PodcastsPageClient`, `PodcastDetailClient`,
`PodcastConfigSheet`, `SegmentConfigForm`, `SegmentConfigSheet`,
`PodcastConfigPreview`, `PodcastEditClient`, `PodcastFindingsTab`,
`AssembleEpisodeDialog`), the `PodcastConfigPreviewRenderer`, six
pages under `app/(root)/podcasts/`, one route under
`app/api/podcasts/run-segment`, one sidebar nav entry. Two FK columns
added to existing tables (`ResearchRun.podcastSegmentId`,
`Monitor.podcastSegmentId`).

**Untouched:** trading tools, trading pages, trading actions,
intelligence pipeline jobs proper (signal-router was extended, not
rewritten), Alpaca, Position/Order/Trade/Thesis/AccuracyReport/
AnalystBriefing, all existing analyst detail / runs feed UI.

See `docs/PODCAST_FILES.md` for the file-level audit and
`docs/PODCAST_OPERATIONS.md` for the detach + fork playbooks.
