> **SUPERSEDED — see [`../THESIS_GAME_PLAN.md`](../THESIS_GAME_PLAN.md) (the trigger-ladder stack that absorbed and extended this); kept as build history.**

# Scale Into Winners — Session Handoff (2026-07-07)

> **Single entry point for the next session.** Read this first, then
> [`SCALE_INTO_WINNERS.md`](./SCALE_INTO_WINNERS.md) (full workstream specs) and
> [`GAPS.md`](../../GAPS.md) (P1-30/31/32). Goal: make the agent *manage conviction* —
> press winners, protect gains, re-enter — not run one-shot bets. The core loop is
> LIVE and validated; the finish line is protection + smart authoring.

---

## What shipped & is LIVE on main (deployed, first-validated 2026-07-07)

| PR | What it does |
|---|---|
| #467 | Caps → **2×** per-name scale-in ceiling on `add_to_position` (+ fixed a latent `realMaxPosition` live-cap bypass) |
| #468 | `RUNNING_WINNER` — 5th `needsAction` kind + inline P&L / progress-to-target in `get_theses` |
| #472 | `RUNNING_WINNER` fires on **abs-gain ≥12% OR ≥75%-to-target** (targets were inflated +18–93%, so pure progress never fired) |
| #470 | Reactive layer: **+7% day → ADD** (all horizons); tactical **press/hold/take** brain + **−7% day → ADD** pullback (COMPOUNDER/TARGET/CATALYST, not TRADE); **re-entry** (take-profit `closeReason=TARGET` → WATCHING, not DEAD) |
| #471 | Thesis-sheet gauge fix (render annotated chart **AND** the entry/target/current/stop gauge, was either/or) |
| #473 | (docs) GAPS P1-30/31/32 filed |

**Tunable constants (all live):**
- `lib/agent/winner-signal.ts`: `RUNNING_WINNER_ABS_GAIN_PCT=12`, `RUNNING_WINNER_PROGRESS_THRESHOLD=0.75`, `RUNNING_WINNER_MIN_GAIN_PCT=8`
- `lib/agent/triggers/defaults.ts`: `SCALE_IN_MOVE_PCT=7` (the +7%/−7% rungs), cooldown 3d
- `lib/agent/position-sizing.ts`: `SCALE_IN_CEILING_MULTIPLE=2`

## First live validation (7/07 morning run) — IT WORKED
`RUNNING_WINNER` fired; the agent ran explicit **press/hold/take** ("*I chose hold/protect rather than press or take*"). It protected IONS/XENE/MU by moving stops; MU's raised stop ($935) then caught its roll-over → proposed exit at ~$922 (**no round-trip**). Verify via the `ThesisUpdate` rows dated 2026-07-07 on HOLDING theses.

---

## Critique of 7/07 — what the next session should fix (intelligent but timid)

1. **PRESS-SHY.** Held/protected everything, pressed (added) **nothing**. **PACS** was the clear miss — fresh highs, +19%, street PT raised to **$51.20 (ABOVE its own $49 target)**, not overextended — warranted a press *or* at least a target-raise + stop-up; got a passive hold. Watch whether it *ever* adds or always defaults to hold.
2. **UNDER-PROTECT.** IONS/XENE stops moved to **breakeven** — guards a *loss*, not the +13% *gain*. Should trail / stop at +X% / trim into RSI>70. → **P1-30**.
3. **LOSER BLIND SPOT (asymmetry).** Winners get `RUNNING_WINNER` attention; **losers get none**. MLTX −15% got no review 7/07 (no fired trigger, future review = invisible — exactly how winners used to be). Consider a symmetric `LOSING_POSITION`/drawdown `needsAction` kind.

---

## The finish line — recommended order

1. **Backfill** — #470's +7%/−7% ADD rungs only attach to *new/refreshed* theses; the current ~12 holdings lack them. One-time backfill (append `scaleInOnStrengthTrigger()`/`scaleInOnPullbackTrigger()` to each HOLDING thesis's `triggers`) — or hand-add. **`RUNNING_WINNER` already covers the current book at the morning check**, so this is intraday reactivity only.
2. **P1-30 gain-protection (HIGHEST — real money).** Trail-from-high / from-set-point + a `>X%` down-day rule; make the agent's "protect" action lock in gains, not just breakeven. NOTE: `TRAILING_STOP` predicate was **removed in #458** (principal wanted daily `PRICE_MOVE_PCT`) — reconcile, don't blind-revert.
3. **Spine (WS0) — the press-shy + smart-levels fix.** Make the writer/agent **author** smart per-thesis add/trim/review levels at mint/entry off real chart structure (support/resistance, ATR), maintain them every run, and gate "no holding left without a forward trigger." This is the delicate live-prompt work (do carefully; validate on a run before it rides the cron — see CLAUDE.md prompt-fragility scars).
4. **Loser-attention** (from the critique) — symmetric `LOSING_POSITION` needsAction so bleeders get re-examined like winners now do.
5. **Target-standardization** — realistic target-gain % per horizon (TRADE ~10 / TARGET ~15–25 / COMPOUNDER ~25–40 / CATALYST event-sized), with event-driven carve-outs (VRDN's +93% is legit). Root fix for inflated targets; #472 floor is the interim.
6. **P1-31** analyst-level standing rules · **P1-32** settings UI · **PR6** review-fetch-data · **PR7** DIRECT add (fireMode on main, unblocked) · **PR8** activity feed & notifications.

---

## Gotchas for the next session (learned the hard way this session)
- **Worktree paths.** cwd is `.claude/worktrees/beautiful-hopper-d3ab13`. Explore/file-finder agents return **main-repo** paths (`/Users/davebixler/hindsight/...`) — editing those hits the WRONG checkout and your change silently vanishes on branch switch. **Always edit the worktree path.**
- `gh auth switch --user dave-sucks` before any push (it reverts to `db-lev`, which lacks perms).
- `npx prisma generate` in the worktree before `tsc`/`jest` (the `lib/generated` stale-drift gotcha).
- Squash-merges break stacked branches — `git rebase --onto origin/main <old-base>` to recover a clean diff.
- Everything is **approval-gated** — proposals never auto-fill. Merged PRs only change behavior once deployed; verify Vercel `success` on the main tip (dropped-webhook gotcha).
