# Discovery Funnel — session yield log

> **What this is:** one row per discovery session, tracking how many names survive each
> stage of the funnel. This is the file that makes "improve discovery over time" measurable
> instead of a vibe.
>
> **Who writes it:** `/discovery-prep` adds the row when the operator pastes back raw
> scout output. `/review-discovery` fills the `entered` / `resolved` columns weeks later
> when the dispatched names actually play out.
>
> **Raw output lives in** [`raw/`](./raw/) — one file per session, prompt paired with the
> output it produced. Without that pairing you cannot tell a bad prompt from an empty window.

---

## Why the stages matter

Each stage that leaks points at a **different fix in a different layer**. That's the whole
reason to count them separately:

| Symptom | The problem is | Fix lives in |
|---|---|---|
| Few names **returned** at all | Prompt design | The Grok/Perplexity prompts |
| Many returned, few **pass gates** | Sourcing quality — wrong scouts or wrong event types | The play + the scout roster |
| Many **dispatched**, few **entered** | Slot scarcity or entry timing | Analyst config / daily-run behavior |
| Many **entered**, poor **outcomes** | Triage scoring | The Hindsight Discovery paste |

---

## Sessions (newest first)

| Date | Analyst | Lane | Play | Returned | Passed gates | Dispatched | Entered | Resolved W/L | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 2026-08-10 | Catalyst Event PM | tech (semis/software) — **re-run** | C | ~15 | **0** | 0 | — | — | **Prompt worked; the lane didn't.** Breadth-first, caps labeled-not-gated → 30+ items, still zero in-fence binaries. What exists is investor days + industry conferences (**not binary events**) and mega-caps. Grok's own caveat: M&A vote dates and dockets "require case-by-case SEC monitoring." **→ route the tech lane to EDGAR/index methodology, not Grok.** One lead: SYNA ($4.1B, ON target — watch for the DEFM14A vote date). |
| 2026-08-09 | Catalyst Event PM | tech (semis/software) | C | **0** | 0 | 0 | — | — | **Prompt failure, not an empty window.** 4 ANDed filters + required in-post docket citation + conversation-scoped summarize turn → "no rows qualify." Also aimed at the rarest event slice (IPR/antitrust is mega-cap = out of fence). Rewritten toward M&A vote dates + index rebalances. See `raw/2026-08-09-CATALYST-grok.md`. |
| 2026-08-09 | Catalyst Event PM | biotech (PDUFA) | D→C | **~40** | **4** *(6 pre-verification)* | _pending_ | | | Turn yield: **T1 (Play D, 5-handle bench) = 2** · **T2 (bench expansion) = +5 handles, 0 names** · **T3 (wide sweep, filters dropped) = 38** · **T4 (social orbit) = 0 net-new**. **Verification killed 2 of 6: SVRA** (PDUFA extended Aug 22 → **Nov 22**, never enterable) and **INO** ($0.08B, not "under $2B" — 12× below floor + FDA flagged accelerated-approval eligibility). Survivors: **ZYME, NUVL, MIRM, SRRK**. Two flags on held names (CYTK late-Aug readout; PRAX late-Sep). |

---

## Column definitions

- **Returned** — distinct tickers the scout tools surfaced, before any filtering.
- **Passed gates** — survived the hard gates in the Hindsight paste (dated + primary-sourced,
  $1B–$20B, in-fence industry, ≥ position floor, inside the entry window).
- **Dispatched** — minted as `WATCHING` theses by the Discovery agent (cap: 5/session).
- **Entered** — actually became a `Position` (lags days-to-weeks; slot-constrained).
- **Resolved W/L** — outcome once the catalyst resolved (lags weeks). Filled by
  `/review-discovery`.
