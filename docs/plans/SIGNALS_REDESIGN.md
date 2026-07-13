# Signals / News Redesign — P1-34 decision doc

> **What this is.** The decision-ready design for where news lives in Hindsight.
> Expands `TRIGGER_LIFECYCLE.md` §6's three candidate models into fully-worked
> architectures with costs, migration paths, and a decision sheet. **Doc only —
> no code changed.** Written 2026-07-12.
>
> **The question being decided:** where does news belong — at discovery time?
> all day via standing routing? per morning run? per review of a specific
> thesis? per tactical run only? Signals all day vs only-when-needed so they're
> not stale?
>
> **The constraint stack (principal, verbatim intent):**
> - "I used to have signals pulling all day and getting routed — the signals
>   themselves were trash and expensive. And they were mostly being used for
>   discovery."
> - "Then I had them read every morning for daily runs, but that meant
>   basically reading all theses and stocks and all news every day." —
>   unaffordable and unfocused.
> - Cost sensitivity is real (~$15/day was deemed too high; see
>   `docs/plans/OPENAI_COST_REDUCTION.md`).
> - The Sunday discovery cron is **paused by explicit principal decision**;
>   this design references how discovery *would* reconnect but does not assume
>   unpausing it.
> - The trigger system is now the spine of position management
>   (`docs/plans/THESIS_GAME_PLAN.md`). News's most valuable role is powering
>   the signal-side rungs (`SIGNAL_TYPE` / `EARNINGS_BEAT` / `EARNINGS_MISS` /
>   `GUIDANCE_CHANGE` / `FILING`) that currently never fire.

---

## 0. Why routing is severed (the diagnosis)

Verified state (prod SQL, 2026-07-12): **327 signals flowed in 14 days**
(264 NEWS + 63 EARNINGS, latest same-day), **18 monitors ran within 7 days**,
but **0 `AnalystSignalRoute` rows in 14 days** and **0 signal-side trigger
fires out of 232 total fires**.

The cause is **not** a code bug. It's **PR #361 (2026-06-01, "kill the noise
pipeline")** — see `docs/plans/DISCOVERY_OVERHAUL.md` "Shipped 2026-05-31 →
Operational (no code)":

1. **NOW-1** paused four Inngest functions **in the Inngest dashboard**
   (operational state, invisible in code): `firm-market-sweep`,
   `portfolio-watchlist-monitor`, `domain-monitor`, and — critically —
   **`signal-router`**. The functions are still registered in
   `app/api/inngest/route.ts` and their crons still declared in code
   (`lib/inngest/functions/signal-router.ts:341` — daily 7:30 AM ET cron +
   `intelligence/route-signals` event), but a paused Inngest function skips
   both cron ticks and inbound events.
2. **NOW-2** disabled all 65 non-builtIn monitors via SQL
   (`UPDATE "Monitor" SET enabled=false WHERE "builtIn"=false`). 6 builtIn
   rows stayed enabled, but their driving crons are the paused ones above,
   so they never run either.
3. **NOW-3** stripped `read_signals` from the daily-run allowlist + prompt
   (`lib/agent/modes.ts:150`, `lib/agent/system-prompt.ts` Stage 1 — the
   prompt now says so explicitly at line ~206).

What still flows, and why the numbers look the way they do:

- **Email-ingest is the one deliberately-live source.**
  `app/api/intelligence/email-ingest/route.ts` is a Resend webhook (an HTTP
  route, not an Inngest function — so pausing crons didn't touch it). It
  extracts signals with GPT-4o-mini, writes them via `createSignal`, and
  auto-creates/stamps one EMAIL `Monitor` per sender — that's the "18 monitors
  ran within 7 days" (`lastRunAt` is stamped per inbound email at
  `findOrCreateEmailMonitor`). The 63 EARNINGS signals are email signals whose
  themes contained "EARNINGS" (`inferSignalType`, route.ts:48).
- **Email-ingest fires `intelligence/route-signals` after every batch**
  (route.ts:216) — into a paused `signal-router`. The event is dropped. So
  signals accumulate with zero routes.
- **No routes → no `app/signal.routed` events → the trigger-evaluator's
  signal-driven path never executes** (`lib/inngest/functions/trigger-evaluator.ts:286`).
  All 232 fires in the window came from the 5-min price cron path. Every
  news/earnings/filing rung on every ladder is decorative.
- **No routes → `read_signals` returns the watchlist fallback or empty** for
  the modes that still have it (discovery [paused], principal, podcast).
- **No routed signals cited → `Thesis.sourceSignalIds` stays empty → the
  monitor-ROI tracer** (`lib/inngest/functions/trade-evaluator.ts:157`,
  step `update-monitor-outcomes`) **skips with `no-source-signals`.** Pillar 5
  is dark.

Two latent code defects that would survive un-pausing (found in this audit):

- **Email signals never get `dataPayload` stamped.** `extractDataPayload`
  (the regex bridge that stamps `surprisePct` / `guidanceDirection` /
  `formType` so `EARNINGS_BEAT`/`EARNINGS_MISS`/`GUIDANCE_CHANGE`/`FILING`
  predicates can match) is only called inside `createSignalsFromSonar`
  (`lib/intelligence/signals.ts:169`). Email-ingest calls `createSignal`
  directly and bypasses it. **Even with routing restored, the only signal-side
  predicate that could fire from today's live source is `SIGNAL_TYPE`** —
  the four structured predicates gate on dataPayload fields that are never
  present. One-line-class fix.
- **The tactical mode can't read signals.** `read_signals` has a documented
  `triggerId` "TACTICAL FOLLOW-UP" parameter for pulling priors
  (`lib/agent/tools/read-signals.ts:208`), but `read_signals` is not in the
  tactical allowlist (`lib/agent/modes.ts`, tactical `toolAllowlist`). That
  priors path is unreachable. (The firing signal itself IS injected into the
  tactical prompt directly — `tactical-run.ts` loads it by `signalId` — so
  the tactical sees the triggering headline, just not history.)

**Needs a DB/dashboard check to fully confirm (no DB access this session):**
the Inngest dashboard pause state of the 4 functions (expected: paused);
that all 327 signals in the window have `searchTool='EMAIL_INGEST'`;
that `Monitor` enabled-rows are exactly {EMAIL senders + 6 builtIn}.
Remember the Inngest rename-ghost gotcha (memory: renaming a function id
leaves a dashboard ghost until manual re-sync) when touching function ids.

---

## 1. Inventory — every producer and consumer, live/dead, cost

### Producers

| Component | File | Status | What it does | Cost profile (when live) |
|---|---|---|---|---|
| **Email-ingest** | `app/api/intelligence/email-ingest/route.ts` + `lib/intelligence/email-signal-extractor.ts` | **LIVE** (the only one) | Resend webhook → GPT-4o-mini extraction (8k-char cap) → `createSignal` per idea → fires `intelligence/route-signals` (dropped) + `triggerUrgentRuns` on BREAKING held tickers | ~2k tok in + ~500 out per email on gpt-4o-mini ($0.15/$0.60 per M) ≈ **$0.0006/email**. At ~23 signals/day ÷ ~3-5 ideas/email ≈ 5-8 emails/day → **~$0.005/day**. Effectively free. |
| Firm market sweep | `lib/inngest/functions/firm-market-sweep.ts` | **PAUSED** (Inngest dashboard, PR #361) | Enabled SEARCH monitors → 1 Sonar call each; + FMP movers ×3 + Finnhub earnings-calendar aggregates | ~15 Sonar calls/day when the SEARCH monitor set was live. Sonar ≈ $5/1k requests + ~$1/M tok; each call ≈ 400 tok in / ≤1024 out → **~$0.007/call** → ~$0.10/day. FMP + Finnhub calls free within plan. |
| Portfolio/watchlist monitor | `lib/inngest/functions/portfolio-watchlist-monitor.ts` | **PAUSED** | 1 Sonar `searchTicker` call per OPEN-position + WATCHING-thesis ticker, daily | ~20-35 tickers × $0.007 ≈ **$0.15-0.25/day** |
| Domain monitor | `lib/inngest/functions/domain-monitor.ts` | **PAUSED** (was also mostly dead pre-pause — 26 dead domain crons per the 2026-04-22 audit) | Per DOMAIN monitor: domain-filtered Sonar + Firecrawl extraction of ≤5 URLs → `Artifact` rows | 26 monitors × $0.007 Sonar ≈ $0.18/day + ≤130 Firecrawl scrapes × ~$0.005 (Standard $16/mo ÷ 3k credits) ≈ **≤$0.65/day**, realistically $0.2-0.4 |
| Signal router | `lib/inngest/functions/signal-router.ts` | **PAUSED** — this is the severed link | Universe fence + relevance + novelty + discovery reservation → `AnalystSignalRoute` rows → emits `app/signal.routed` | DB-only, ~$0 |
| Discovery run (Sunday) | `lib/inngest/functions/discovery-run.ts` | **PAUSED** (explicit principal decision — do not assume unpausing) | Weekly per-analyst scan of routed pool → mints WATCHING theses | gpt-5.4, 45 steps — was part of the ~$15/day complaint |
| xAI twitter_search | `lib/intelligence/xai-live-search.ts` + `lib/agent/tools/twitter-search.ts` | LIVE (pull tool; principal + discovery allowlists) | Grok Live Search over X, handle-attributed | per-call, operator/agent-invoked; grok-4-fast-reasoning, ~$0.01-0.05/call |
| web_search (agent tool) | `lib/agent/tools/web-search.ts` | LIVE | Perplexity Sonar live search, per-run budget (`liveSearchBudget`, default 5) | ~$0.007/call, ≤5/run |
| Thesis ingest (paste) | `lib/intelligence/ingest-thesis.ts` (#460) | LIVE | Mints theses from flat-rate-chat JSON — a *thesis* producer, not a signal producer | ~$0 (reuses record_thesis logic) |

### Consumers

| Component | File | Status | Depends on |
|---|---|---|---|
| Trigger-evaluator **signal path** | `trigger-evaluator.ts:286` (event `app/signal.routed`) | **DEAD** — 0 events since 2026-06-01 | routes. Evaluates `SIGNAL_TYPE`/`EARNINGS_*`/`GUIDANCE_CHANGE`/`FILING` rungs on HOLDING+WATCHING theses covering the signal's tickers, reads `Signal.dataPayload` for surprise/guidance/form. |
| Trigger-evaluator cron path | same file, `*/5 9-16 Mon-Fri` | LIVE | price only. This is where all 232 fires came from. |
| `read_signals` | `lib/agent/tools/read-signals.ts` | **Mostly dead.** Removed from daily-run (NOW-3). Still in discovery (paused), principal, podcast allowlists. Returns fallback/empty. | routes (falls back to raw watchlist-ticker Signal match) |
| `read_artifact` | `lib/agent/tools/read-artifact.ts` | **Dead in practice** — only the domain monitor created Artifacts; email-ingest doesn't | Artifact rows |
| Tactical run signal context | `tactical-run.ts:169` | Dormant | loads the firing `signalId` into the tactical prompt; only signal-path fires carry one |
| Urgent runs on BREAKING email | `lib/intelligence/urgent-trigger.ts` | **LIVE** | bypasses routing entirely: BREAKING email signal on a HELD ticker → `app/research.run.manual` (30-min cooldown). The existing precedent for "event-class push for held names." |
| Monitor-ROI crediting (Pillar 5) | `trade-evaluator.ts:157` | **Starved** — `Thesis.sourceSignalIds` empty on every new thesis since read_signals left the daily run | `sourceSignalIds → Signal.monitorId → Monitor` counters |
| Signals dashboard | `/intelligence`, `app/api/intelligence/*` | LIVE (shows the unrouted pool) | Signal/Batch/Route tables |
| Pipeline cleanup | `lib/inngest/functions/pipeline-cleanup.ts` (11 PM daily) | LIVE | soft-deletes signals at 30d, archives routes |

### The historical cost picture (why "trash + expensive" happened)

The raw API spend of the paused pipeline was small — roughly **$0.5-1.3/day**
(Sonar ~70 calls ≈ $0.50, Firecrawl ≤$0.65, extraction ~$0). The real expense
was downstream: 40-route/analyst/day caps × 6 analysts of ~5%-signal-to-noise
content (2026-06-01 audit) fed gpt-5-class agents that burned **steps** triaging
it — and steps are reasoning+output tokens at ~$10/M plus wall-clock. The
observed spend was ~$15/day (~$7 morning runs, ~$4.5 tacticals incl. refire
storms) before the OPENAI_COST_REDUCTION work. The lesson that must survive
this redesign: **the cost of a signal is dominated by the agent-attention it
consumes, not the API call that produced it.** Any architecture that puts
low-precision text back in front of gpt-5-class runs re-creates the bill.

---

## 2. The placement matrix — where news could live

For each candidate insertion point: what question news answers there, how stale
it can be, its cost shape, and what breaks if news is absent there.

| Insertion point | Question news answers | Staleness tolerance | Cost shape | Failure mode if absent |
|---|---|---|---|---|
| **Discovery time** | "What names should enter coverage?" | Days — a discovery candidate found 3 days late is usually still a candidate | Per-scan (weekly cron or operator session) | Coverage goes stale; fewer net-new names. *Currently accepted*: discovery is deliberately parked and operator-driven (paste + principal chat + pull tools). |
| **All-day standing routing (firehose)** | "What's happening everywhere in my universe?" | Hours | **Per-day, unbounded by relevance** — cost scales with universe breadth, not with the book | Nothing breaks. This is the tier the principal already killed for trash+cost. Its only unique value — serendipitous discovery — is parked by decision. |
| **Morning run (read-everything)** | "What happened overnight across my whole book + inbox?" | ~18h (overnight gap) | Per-day × per-analyst — every thesis × all news, the "unaffordable and unfocused" shape | Agent walks the book blind to overnight news *unless* per-name review pulls cover it (they do — `get_stock_data` embeds 7d Finnhub news). Absence is survivable **iff** per-thesis review pulls exist. |
| **Per-thesis review (targeted pull)** | "Since I last looked at $X, did anything change that touches my assumptions?" | = review cadence (1d CATALYST/TRADE, 7d TARGET, 30d COMPOUNDER) | **Per-review, scoped** — 1 Finnhub news call (free) + 0-2 web_search ($0.007 ea) per reviewed name | Reviews re-attest prose against stale evidence — the rubber-stamp failure the Spine's audit gates exist to stop. This placement is already live (Stage-1 note in `system-prompt.ts`: "structured material-event coverage… pulled fresh per name during the review loop"). |
| **Tactical run validation** | "The trigger fired — does live context confirm or refute acting?" | Minutes | Per-event, scoped — tactical allowlist already has `web_search`, `get_stock_data`, `get_sec_filings` | Tactical acts on price alone; fine for mechanical rungs, bad for judgment exits (earnings gap: is it a miss or a sympathy move?). Already live. |
| **Event-class push (book-scoped)** | "A *material, classifiable* event just hit a name I hold/watch — wake the ladder" | **Minutes-to-hours — this is the only placement where staleness is fatal** (an earnings miss found at tomorrow's review is a −12% surprise, the IONS shape) | Per-event × per-book-name — bounded by ~12-25 tickers × a few real events/week | **The signal rungs never fire.** Every `EARNINGS_BEAT`/`FILING`/`GUIDANCE_CHANGE` rung the Spine's agents author is decorative; positions are protected by price rungs only, i.e. the system finds out about news via the price damage it causes. This is today's state. |

Reading of the matrix: the placements are **not** alternatives competing for
one budget — they answer different questions. The genuinely contested decision
is only the middle tier: **does anything push, and if so, what?** Review-time
pull and tactical validation are already live and uncontroversial. The
firehose and read-everything placements are already killed and shouldn't come
back. Discovery is parked. What's undecided is the event wire.

---

## 3. Three architectures, fully worked

Common facts used in all three costings: book ≈ 11 HOLDING + ~10-15 WATCHING
≈ **~20-25 unique tickers**; ~6 enabled analysts; email-ingest ≈ 5-8
emails/day. Sonar ≈ $0.007/call; gpt-4o-mini ≈ $0.0005 per short vet;
a tactical run ≈ $0.30-0.50 (gpt-5.4, ≤15 steps).

### Architecture A — Vetted push

Signals are produced broadly (as before), but a route only materializes when
the signal **matches a thesis trigger + passes a materiality gate**; a match
elevates to a tactical/review. Everything else is visible only if a review
pulls it.

```
  Sonar text producers (book+universe queries)      email-ingest (live)
        │                                                │
        ▼                                                ▼
   Signal rows  ──────────► VET GATE ────────► matched? ──► AnalystSignalRoute
   (dataPayload stamped)    (materiality:          │            │
                             trigger-match          │no          ▼
                             ∧ urgency/LLM)         ▼        app/signal.routed
                                              signal sits      │
                                              unrouted;        ▼
                                              review-time   trigger-evaluator
                                              pull only     signal path
                                                                │ rung match
                                                                ▼
                                                    TRIGGER_FIRED → tactical
                                                    (REVIEW defers to daily)
```

- **Reused:** signal-router (heavily slimmed — the vet gate replaces the
  universe fence/novelty/discovery-reservation), trigger-evaluator signal
  path, `AnalystSignalRoute`, email-ingest, `data-payload-extractor`,
  `read_signals` (as the review-time window into vetted+unvetted pool).
- **Deleted:** domain-monitor + Firecrawl, the discovery-oriented scoring
  (novelty, relevance weights, discovery reservation, CROSS_ANALYST), the
  read_signals discovery bucket.
- **Cost:** producers are the question. If Sonar text queries stay
  (book-scoped: ~25 tickers/day ≈ $0.18/day; universe-scoped: back toward the
  old $0.5-1/day *and the old trash*), plus vet ($0.015/day if LLM), plus
  extra tacticals from real fires (~3-8/wk ≈ $0.15-0.45/day). **≈ $0.4-1/day.**
- **What fires the ladder's signal rungs:** anything the producers can
  express — but *only as reliably as regex extraction over prose*
  (`data-payload-extractor` is lossy by design: "beat by 12%" extracts,
  "exceeded estimates handily" doesn't). The rungs fire on paraphrased text
  confidence.
- **Staleness:** minutes from producer run to fire — but the *producers* are
  daily crons, so effective staleness is up to ~24h unless the crons multiply.
- **Monitor-ROI:** reattaches naturally — routes exist, read_signals citation
  flows to `sourceSignalIds`, `trade-evaluator` credits.
- **The honest problem:** A keeps the trash generator and adds a filter in
  front of it. The vet gate is a new judgment layer with exactly the
  novelty-gate failure mode (silently eating real signals — the scar from
  #163-#166 and the 2026-04-22 audit). And the signal rungs end up powered by
  regex-over-paraphrase instead of structured data.

### Architecture B — Review-time pull only

No standing routing at all. Every review/tactical pulls news scoped to what
it's evaluating. (This is PR6 of the trigger-followups generalized — and is
very close to today's *de facto* state, minus intentionality.)

```
   daily run ── per thesis ──► get_stock_data (7d Finnhub news, free)
                               get_sec_filings / get_earnings_data (on demand)
                               web_search (≤5/run, $0.007 ea)
   tactical run (price rung fired) ──► same pull set, scoped to the one name
   email-ingest ──► urgent-trigger only (BREAKING on held → manual run)
   [Signal table becomes an email archive; router deleted]
```

- **Reused:** the pull tools (all live today), urgent-trigger, email-ingest
  (reduced to the urgent path).
- **Deleted:** signal-router, `AnalystSignalRoute`, `read_signals`,
  trigger-evaluator's entire signal path, the four Sonar/Firecrawl producers,
  **and the five signal-side predicate kinds** — they can never fire without
  a Signal in the evaluation context, so keeping them in the vocabulary is a
  lie the agent-authored ladders would keep telling. Earnings awareness
  degrades to the `nextReviewAt`-pinning pattern (TRIGGER_LIFECYCLE §5:
  "a holding should never be surprised by its own earnings").
- **Cost:** **~$0.05-0.2/day** (Finnhub news is free in-plan; a few
  web_searches per run). Cheapest by far.
- **What fires the ladder's signal rungs:** **nothing — the rungs are
  removed.** News can only influence the book at review cadence or when a
  price rung fires first.
- **Staleness:** = review cadence. A TARGET-horizon holding on a 7d cycle is
  news-blind for a week unless the price moves enough to fire a % rung. The
  system learns about an earnings miss from the −12% print, not the 8:31 AM
  release. This is precisely the IONS failure class transplanted to news.
- **Monitor-ROI:** dies. No Signal provenance on theses; the tracer has
  nothing to credit. Pillar 5's "source list narrows over months" is
  abandoned (or re-anchored on tool-call provenance, which is a different,
  weaker system).

### Architecture C — Hybrid (event-class push for the book + pull for the rest)

Mechanical/price rungs stay push (already live). News becomes **event-class
push for HELD+WATCHING names only** — earnings prints, guidance, filings/8-K,
insider clusters, (later) analyst actions, on ~12-25 tickers — from
**structured producers, not Sonar prose**. Everything else is review-time
targeted pull. Discovery firehose stays parked.

```
 STRUCTURED PRODUCERS (book-scoped, ~free)        email-ingest (live, as-is
 ├─ earnings-actuals: Finnhub /calendar/earnings   + dataPayload fix)
 │   epsActual vs estimate → surprisePct           │
 ├─ EDGAR 8-K/Form-4 atom poll (MEDIUM-1 spec)     │
 │   item taxonomy → formType / insider cluster    │
 └─ (later) FMP analyst actions                    │
        │                                          │
        ▼                                          ▼
   Signal rows (type + dataPayload GUARANTEED, monitorId per producer)
        │
        ▼
   BOOK-ROUTER (thin, deterministic): ticker ∈ {OPEN positions ∪ WATCHING
   theses} per enabled analyst → AnalystSignalRoute (POSITION/WATCHLIST only,
   no relevance scoring, no novelty, no universe fence)
        │
        ▼
   app/signal.routed ──► trigger-evaluator signal path (UNCHANGED)
        │ rung match: EARNINGS_BEAT/MISS, GUIDANCE_CHANGE, FILING, SIGNAL_TYPE
        ▼
   TRIGGER_FIRED audit row → ENTER/EXIT/ADD/TRIM → tactical (approval-gated)
                              REVIEW (non-BREAKING) → deferred to daily (as today)

 EVERYTHING ELSE = pull:  daily review loop + tactical validation keep
 get_stock_data / get_sec_filings / get_earnings_data / web_search, scoped
 to the name under review.  Discovery = parked (operator-driven chat + pull
 tools + paste ingest), reconnects later by pointing the same producers'
 out-of-book events at a discovery surface IF unpaused.
```

- **Reused unchanged:** trigger-evaluator signal path, `AnalystSignalRoute`
  schema, `app/signal.routed` contract, tactical-run's signalId context,
  email-ingest, urgent-trigger, all pull tools, REVIEW-batching economics.
- **Modified:** email-ingest gains the `extractDataPayload` call (the fix
  from §0); a thin **book-router** replaces the paused signal-router for the
  push tier (new function id — cleaner than un-pausing the 1,000-line
  discovery-era router; mind the Inngest rename-ghost gotcha and re-sync).
- **Deleted:** domain-monitor + Firecrawl client + (in practice)
  `read_artifact`; firm-market-sweep's Sonar monitor loop;
  portfolio-watchlist-monitor's Sonar loop; the router's universe
  fence/novelty/relevance/discovery-reservation machinery (archived with the
  file — it's discovery infrastructure, revisit only if discovery is
  rebuilt); the movers/earnings-calendar *aggregate push* (their pull-tool
  counterparts `get_market_movers` / `get_earnings_calendar` are live and
  are the sanctioned access path).
- **Cost arithmetic:**
  - Finnhub earnings-actuals poll: 2 crons/day (post-close + pre-open) × 1
    calendar call + ~book-size quote checks — free in-plan. **$0.**
  - EDGAR atom poll every 15 min market hours: free. **$0.**
  - Email-ingest: unchanged, ~$0.005/day.
  - Book-router: DB only. **$0.**
  - Incremental tacticals from real events: a 20-name book reports ~20
    prints/quarter ≈ 0.3/day; material 8-Ks maybe 1-2/wk; assume 3-6 extra
    tacticals/wk × $0.40 ≈ **$0.17-0.35/day**. REVIEW-class fires defer to
    the daily run (already-paid tokens).
  - Review-time pull: as B, ~$0.05-0.2/day.
  - **Total ≈ $0.25-0.55/day**, dominated by tacticals that fire on real,
    named events — the spend is proportional to *events on the book*, not to
    universe breadth or crawl volume.
- **What fires the ladder's signal rungs:** structured facts. `EARNINGS_BEAT
  {minSurprisePct}` fires off an actual `epsActual/epsEstimate` computation;
  `FILING {formType:"8-K"}` fires off the EDGAR feed itself, not a headline
  that mentions "8-K". `SIGNAL_TYPE` keeps working for email/newsletter
  content. Extraction confidence stops being the bottleneck.
- **Staleness:** push classes minutes-to-hours (poll cadence); pull classes =
  review cadence; urgent path (BREAKING email on held names) immediate — all
  three already match their placement's tolerance from §2.
- **Monitor-ROI:** each structured producer is a `Monitor` row (the pattern
  `monitor_finnhub_earnings` / `monitor_fmp_*` already establishes), email
  senders already are. Two credit paths: (1) mint-time — discovery/ingest
  theses citing `sourceSignalIds` (unchanged mechanism, populated again the
  moment routes exist for surfaces that read signals); (2) **new,
  recommended:** extend `trade-evaluator` to also credit monitors of signals
  referenced by `ThesisUpdate(type=TRIGGER_FIRED).signalIds` during the hold —
  crediting *exit/management quality*, not just sourcing. That extension is
  what makes Pillar 5 meaningful in a world where most news value is
  protective rather than generative.

---

## 4. Event-class coverage audit — what has a working producer TODAY

"Working" = could stamp a Signal that the signal-side predicates can actually
match, if routing existed.

| Event class | Producer today | Status | What the missing piece takes |
|---|---|---|---|
| **Earnings calendar (upcoming)** | firm-market-sweep Finnhub aggregate (paused) + `get_earnings_calendar` pull tool (live) | **Pull: live. Push: paused.** | Nothing for pull. For "never surprised by your own earnings," cheapest is `nextReviewAt` pinning at review time (TRIGGER_LIFECYCLE §5) — zero producer needed. |
| **Earnings actuals (beat/miss/surprise%)** | None structured. Only regex over Sonar prose (`data-payload-extractor`, paused path) — and email signals bypass even that (§0 defect) | **DEAD** | **Small PR, $0:** Finnhub `/calendar/earnings` returns `epsActual` + `epsEstimate`; a post-close + pre-open cron over book names computes `surprisePct` and writes `Signal(type=EARNINGS, dataPayload:{surprisePct})`. This single producer lights up `EARNINGS_BEAT`/`EARNINGS_MISS`. |
| **Guidance changes** | Regex-only (`GUIDANCE_UP/DOWN_PATTERNS`), same dead path | **DEAD** | No clean free structured source. Bridge: run `extractDataPayload` over Finnhub `company-news` for book names inside the earnings-actuals producer (guidance almost always co-arrives with prints), + the email-ingest dataPayload fix. Accept lossiness; upgrade later if a structured source (e.g. Benzinga wire, DISCOVERY_OVERHAUL MEDIUM-2) is bought. |
| **Filings — 8-K / 10-K/Q / Form 4** | `get_sec_filings` pull tool (live, EDGAR). No push producer. | **Pull: live. Push: none.** | **MEDIUM-1 is already spec'd** (`DISCOVERY_OVERHAUL.md`): EDGAR atom `getcurrent?type=8-K/4` poll, item taxonomy (2.02 earnings, 4.02 restatement, 5.02 departures), Form-4 cluster detector. Free, ~1 wk. Lights up `FILING`. |
| **FDA / clinical catalysts** | Nothing structured. Email newsletters cover it incidentally (SIGNAL_TYPE). | **NONE** | Free structured sources don't exist (BiopharmCatalyst et al. are paid; FDA.gov calendars are scrape-grade). Material FDA outcomes surface as 8-Ks anyway → the EDGAR producer is the pragmatic 80%. Defer a dedicated producer until a biotech-heavy analyst exists. |
| **Analyst actions (PT changes, up/downgrades)** | FMP consensus targets inside `get_stock_data` (pull, point-in-time); Finnhub recommendation trends (coarse/monthly) | **Pull: partial. Push: none.** | FMP `/stable` price-target / upgrades-downgrades endpoints exist but are plan-gated (the legacy-plan 403 scar — verify before building). No predicate exists for it either (`SIGNAL_TYPE {type:ANALYST_NOTE}` is the vocabulary today). Defer; review-time pull covers it. |
| **Market movers** | FMP aggregates (paused push) + `get_market_movers` pull (live) | **Pull: live.** | Nothing — pull + the 1D `PRICE_MOVE_PCT` cron rung already cover the "my name is moving" case, which is the book-relevant slice. |
| **Social / X attention** | `twitter_search` pull (live, xAI) | **Pull: live** (operator/discovery surfaces) | Standing X monitoring is a discovery-tier feature — parked with discovery. |
| **Generic news prose** | email-ingest (live); Sonar ticker/domain searches (paused) | **Email only** | This is the class the principal called trash. Recommendation: never rebuild it as push; review-time pull (free Finnhub 7d news in `get_stock_data`) + email newsletters are the durable shape. |

Bottom line: **earnings-actuals + EDGAR filings are the two producers that
matter, both are free, and one of them is already spec'd.** Guidance rides the
earnings producer lossily. FDA rides 8-Ks. Analyst actions defer.

---

## 5. Materiality gate options

The gate question only exists on the push tier (a pull is self-gating — the
agent asked). The scar to respect: the novelty/dedup gate obliterated real
signals before (2026-04-22 audit: novelty=5 killed every MEDIUM signal on held
names until three carve-outs were bolted on — `signal-router.ts:647-698`).

| Option | Mechanism | Cost | Precision/recall | Verdict |
|---|---|---|---|---|
| **Trigger-match-only** (no separate gate) | A pushed signal routes to book names; the *only* thing that spawns work is a rung matching (`shouldFire` + cooldowns). Non-matching signals just sit in the inbox for the next review. | $0 | Precision: perfect w.r.t. declared intent — the agent authored the rung; firing it is by definition material. Recall: bounded by ladder quality — which is exactly what the Spine (Game Plan PR-C) now enforces (authorship gates, re-ladder duty, UNPROTECTED_GAIN audit). | **Recommended for tactical spawning.** The ladder IS the materiality model, agent-authored per-thesis. A second gate in front of it double-filters and reintroduces the silent-drop failure. |
| **Urgency threshold** | Producer-stamped urgency floors what can wake anything (BREAKING → immediate run via urgent-trigger; HIGH → allowed to spawn; MEDIUM/LOW → inbox only). | $0 | Crude; extractor urgency-inflation is real (email extractor stamps urgency from newsletter tone). But cheap and already load-bearing (REVIEW-batching exempts BREAKING; urgent-trigger gates on BREAKING). | **Keep exactly where it already is** — as the run-*waking* modifier (BREAKING bypass, REVIEW deferral) — not as a routing filter. |
| **Cheap-LLM vet** | gpt-4o-mini scores each (signal, thesis) pair for materiality against the thesis belief before routing/firing. | ~$0.0005/pair; ~30 signals × ~2 theses/signal ≈ $0.03/day | Best prose judgment; but adds latency, a prompt to maintain, and a *judgment layer that can silently drop real signals* — the novelty scar with an LLM face. Also redundant when producers are structured (an EDGAR 8-K on a held name doesn't need a vibe check). | **Hold in reserve.** Only justified if a prose-heavy push class returns (e.g. Benzinga wire, MEDIUM-2 spec'd it as a "pre-grader") — never in front of structured producers. |
| Dedup/novelty (for completeness) | fingerprint dedup at producer (`deduplicateSignals`) + per-analyst novelty at router | $0 | Producer-level fingerprint dedup is fine and keeps. **Per-analyst novelty must not apply to book names** — that's the exact bug that starved TMT of NVDA position news. | Keep producer dedup; the thin book-router runs no novelty at all. |

Composite recommendation: **structured producers + book-scoped routing +
trigger-match as the gate + the existing urgency modifiers.** Zero new
judgment layers.

---

## 6. Recommendation — Architecture C, with a specific migration path

**Pick C (hybrid).** Justification against the record:

1. **Cost history.** The expensive-and-trash tier was Sonar-prose production
   plus agent triage attention. C rebuilds neither: its push tier is free
   structured APIs scoped to ~20-25 tickers, and its agent attention is spent
   only when an agent-authored rung matches a real event (~$0.25-0.55/day
   all-in vs. the old $15/day complaint). B is marginally cheaper but pays
   for it by deleting the signal rungs; A re-creates the trash generator
   behind a new filter.
2. **The trigger spine.** THESIS_GAME_PLAN's whole model — front-loaded
   ladders, tactical re-ladder duty, daily audit — assumes rungs *fire*.
   Five of the twelve predicate kinds are signal-side. Only a push
   architecture can fire them between reviews; C is the cheapest push that
   fires them off facts instead of paraphrase. The IONS lesson generalizes:
   protection that waits for the next review is not protection.
3. **Pillar 5.** Only architectures with Signal provenance keep monitor-ROI
   alive. C reattaches it and (via the TRIGGER_FIRED crediting extension)
   makes it measure what news is now for: protecting and managing positions,
   not just sourcing them.
4. **It matches what already survived.** Email-ingest (kept), urgent-trigger
   (kept), pull tools in the review loop (kept), REVIEW-batching (kept),
   discovery parked (kept). C is the minimal completion of the system the
   principal already converged on by deletion.

### Migration path from the severed state

Order chosen so each PR is independently shippable and the trigger wire lights
up before anything is deleted.

| # | PR | Contents | Size |
|---|---|---|---|
| 0 | **Hygiene + confirmation** | DB/dashboard check of §0's assumptions (pause states, monitor rows, signal provenance). Wire `extractDataPayload` into email-ingest (`createSignal` call site in the route) so EARNINGS/FILING emails carry `dataPayload`. Decide the tactical `read_signals` question (Q7). | XS |
| 1 | **Book-router** | New thin Inngest fn (new id, re-sync the app — rename-ghost gotcha): consumes `intelligence/route-signals` + a daily cron; routes signals whose tickers ∈ {OPEN positions ∪ WATCHING theses} per enabled analyst as POSITION/WATCHLIST `AnalystSignalRoute` rows; emits `app/signal.routed` with the existing new-routes-only dedup semantics (steal the `existingRouteKeys` pattern from `signal-router.ts:511` — it prevents the 10×-tactical refire storm). `signal-router` stays paused. **This alone reconnects email signals → SIGNAL_TYPE rungs → tactical, and restarts monitor-ROI data.** | S |
| 2 | **Earnings-actuals producer** | Finnhub `/calendar/earnings` post-close (≈5 PM ET) + pre-open (≈8 AM, before the daily run) crons over book tickers → `Signal(type=EARNINGS, dataPayload:{surprisePct, guidanceDirection?})`, own `Monitor` row, fires `intelligence/route-signals`. Lights `EARNINGS_BEAT`/`EARNINGS_MISS`/`GUIDANCE_CHANGE`. | S-M |
| 3 | **EDGAR 8-K/Form-4 producer** | Per the MEDIUM-1 spec in `DISCOVERY_OVERHAUL.md` (atom poll, item taxonomy, Form-4 cluster detector), book-scoped for now (drop the spec's discovery-routing branch while discovery is parked). Lights `FILING`. | M |
| 4 | **Monitor-ROI extension** | `trade-evaluator.ts` step `update-monitor-outcomes`: additionally collect `signalIds` from the position's thesis `ThesisUpdate(type=TRIGGER_FIRED)` rows during the hold window and credit those monitors too (separate counters or a `role` tag — sourcing vs. management credit — decide in-PR). | S |
| 5 | **Deletions** | Delete `domain-monitor.ts`, `firecrawl.ts`, `read_artifact` tool + renderer wiring; delete the Sonar monitor loop from `firm-market-sweep.ts` and the whole `portfolio-watchlist-monitor.ts`; keep the FMP-movers/earnings-calendar aggregate steps ONLY if some surface still reads them (the pull tools don't need them) — otherwise delete the fn and its dashboard entry; archive `signal-router.ts` (git history keeps the universe-fence machinery for a future discovery rebuild). Update CLAUDE.md's "V3 Intelligence Pipeline" section — it describes a dead pipeline today. | M |
| 6 | **Prompt touch (with care)** | Daily-run prompt: the Stage-1 note already promises "structured material-event coverage moving to per-thesis triggers" — after PR 2-3, add one line telling the agent TRIGGER_FIRED news rungs arrive via `needsAction` (already true via REVIEW-batching). Tactical prompt: news-fire framing (the §5 frames in THESIS_GAME_PLAN already cover checkpoint semantics). Honor the stage-header landmines in CLAUDE.md. | S |

Explicitly **not** in the path: un-pausing `signal-router` /
`firm-market-sweep` / `portfolio-watchlist-monitor` / `domain-monitor` (they
stay paused, then die in PR 5); rebuilding any Sonar prose push; touching the
Sunday discovery cron.

Discovery reconnection (for the record, not for now): when/if discovery is
rebuilt, the same structured producers gain an out-of-book branch (the
dual-role pattern from `DISCOVERY_V2.md` §3) and route to whatever discovery
surface exists then. Nothing in C forecloses it; the archived router is the
starting point if universe-fencing is wanted again.

---

## 7. Decision sheet — questions only the principal can answer

Each with a recommended default. This section powers the design session.

| # | Question | Options | Recommended default | Why it matters |
|---|---|---|---|---|
| 1 | **Pick the architecture.** | A vetted-push / B pull-only / C hybrid | **C** | Everything below assumes it. If B, strike the signal-side predicates from the trigger vocabulary in the same PR — decorative rungs on agent-authored ladders are worse than absent ones. |
| 2 | **Push-tier scope: HELD only, or HELD+WATCHING?** (~11 vs ~20-25 tickers) | held / held+watching | **HELD+WATCHING** | WATCHING entry rungs are the Pillar-3 promotion path — an earnings beat on a watched name is exactly the ENTER catalyst the ladder was written for. Cost delta is ~free (same API calls, more tickers in the filter). |
| 3 | **Which event classes, in order?** | earnings-actuals / filings / guidance / analyst-actions / FDA | **Earnings-actuals (PR 2) → EDGAR filings (PR 3); guidance rides earnings lossily; analyst-actions + FDA deferred** | Sequencing the producer PRs. FDA materially = 8-Ks for now; analyst-actions need an FMP plan check first. |
| 4 | **Materiality gate for the push tier?** | trigger-match-only / urgency floor / cheap-LLM vet | **Trigger-match-only** (+ existing BREAKING/REVIEW urgency modifiers, unchanged) | The ladder is the agent-authored materiality model; a second filter re-creates the novelty-scar silent drop. Say yes explicitly so nobody re-adds a gate "for safety." |
| 5 | **May news rungs spawn tacticals at current REVIEW-batching economics?** (ENTER/EXIT/ADD/TRIM fire tacticals ~$0.40 each; REVIEW defers to daily unless BREAKING) | yes / tighten (defer more) / loosen | **Yes, unchanged** | This is the marginal-cost dial. Expected extra spend ≈ $0.2-0.35/day at book scale. If the first weeks show refire noise, tighten per-kind cooldowns, not the gate. |
| 6 | **Delete the Sonar prose producers permanently** (domain-monitor + Firecrawl + portfolio/watchlist Sonar loops + firm-sweep search loop), or keep parked? | delete / keep paused | **Delete (PR 5)** | Paused infra rots and invites "just un-pause it" regressions (this doc exists because operational pause state was invisible in code). Git history preserves everything; the audit already showed the content was ~5% signal. |
| 7 | **Tactical `read_signals`:** add it to the tactical allowlist so the documented `triggerId` priors path works, or remove the parameter? | add / remove param | **Add to tactical allowlist** | Post-PR-1 there will be real prior-fire history worth reading ("last two times this earnings rung fired, the agent held and was right"). One-line allowlist change; the tool code already handles it. |
| 8 | **Monitor-ROI: extend crediting to trigger-firing signals** (management credit), or keep mint-time-only (sourcing credit)? | extend / keep | **Extend (PR 4)** | In C, most news value is protective. Mint-only crediting would leave the ROI table nearly as dark as today, since the daily run no longer mints from a signal inbox. |
| 9 | **Budget ceiling for the whole news layer** (producer APIs + incremental tacticals) before it must come back for review? | $/day | **$1/day** | Gives the system a tripwire consistent with the cost history; C's estimate is ~$0.25-0.55/day, so hitting $1 means something is refiring. |
| 10 | **Confirm discovery stays parked** and out of this build (producers ship book-scoped only; no universe fencing, no discovery routing). | confirm / reopen | **Confirm** | Prevents scope creep back into the architecture that was deliberately killed. Reopening discovery is its own session per the GAPS P2 note. |

---

## See also

- `docs/plans/TRIGGER_LIFECYCLE.md` §6 — the framing this doc expands.
- `docs/GAPS.md` P1-34 — the tracked gap.
- `docs/plans/THESIS_GAME_PLAN.md` — the trigger spine this design serves.
- `docs/plans/DISCOVERY_OVERHAUL.md` — the kill decision that severed routing (NOW-1/2/3) + the MEDIUM-1/2/3 producer specs this doc draws on.
- `docs/TRIGGERS.md` — the firing matrix (which predicate fires on which path).
- `docs/VISION.md` Pillars 1 + 5 — discovery (parked) and the learning loop (reattached by PR 4).
