/**
 * The predicate kinds triggers were stored as before the condition shape
 * (docs/plans/TRIGGER_TYPES.md). Rows written before the cutover, a model
 * that still sends a kind, and Inngest events from before it are read
 * through the translator (./legacy); nothing else in the app uses these.
 */

// ── The stored kinds, before the cutover ────────────────────────────────────────────────────

/** "intraday" (default): the live quote. "close": the day's close, read once at 16:20 ET. */
export type PriceBasis = "intraday" | "close";
export type MoveWindow = "1D" | "5D" | "20D";
export type SmaPeriod = 20 | 50 | 150 | 200;

/**
 * The discriminated-union shape every trigger predicate takes. Stored on
 * Thesis.triggers as JSONB; validated by Zod when written via
 * record_thesis / update_thesis. Evaluated by lib/agent/triggers/evaluate
 * when a signal arrives or a periodic price-check fires.
 */
export type LegacyPredicate =
  // ── Price-based — periodic worker against latest quote ────────────────
  // `basis: "close"` means "the day CLOSES past the level": the 5-minute
  // passes skip it and one pass at 16:20 ET evaluates it against the day's
  // close (DAV-247). An intraday poke through a breakout level fails about
  // half the time (TRADING_PLAYBOOK.md D1); a close is the confirmation.
  // Absent = intraday, the behaviour every rung before DAV-247 had.
  | { kind: "PRICE_ABOVE"; level: number; basis?: PriceBasis }
  | { kind: "PRICE_BELOW"; level: number; basis?: PriceBasis }
  // The move over a window. 1D reads the quote's own change vs the prior
  // close. 5D and 20D read the close N sessions back off the daily
  // indicator snapshot (TickerIndicators) — the windows removed 2026-08-25
  // because nothing supplied a close series are back now that something
  // does.
  | { kind: "PRICE_MOVE_PCT"; pct: number; direction: "UP" | "DOWN"; window: MoveWindow }
  // Cumulative % vs the open position's avgCost (LONG: (price−avg)/avg;
  // SHORT inverted). UP = gain milestone ("we're up 10%" → checkpoint
  // re-underwrite); DOWN = drawdown-from-entry ("down 12%" → loser
  // attention). HOLDING-only: no open position in context → false.
  // Complements PRICE_MOVE_PCT, which only sees the single-day move —
  // this is what catches the quiet cumulative winner/bleeder (the IONS
  // +17%-then-loss failure; see docs/plans/THESIS_GAME_PLAN.md).
  // skipIfPeakGainPct / skipIfPeakWithinDays: the big-winner switch. Set
  // together — a run that big, that fast, turns this rung off for good.
  | {
      kind: "GAIN_FROM_ENTRY";
      pct: number;
      direction: "UP" | "DOWN";
      skipIfPeakGainPct?: number;
      skipIfPeakWithinDays?: number;
    }
  // Give-back % off the position's tracked peak (Position.peakPrice —
  // high-water for LONG, low-water for SHORT, maintained by the price
  // monitor). The mechanical gain ratchet: the floor follows the high
  // with no agent memory required. Deliberately distinct from the
  // TRAILING_STOP removed in #458 (that removal traded peak-trailing for
  // daily-% moves; this reinstates cumulative protection ALONGSIDE the
  // daily-% predicate, not instead of it). HOLDING-only.
  //
  // Optional (DAV-250): `armAtGainPct` keeps the trail off until the
  // position has once been up that much (a TARGET position isn't trailed
  // tight from day one). Where it fires: ./trail.
  | { kind: "TRAILING_FROM_HIGH"; pct: number; armAtGainPct?: number; atrMultiple?: number }

  // ── Chart-based — the live quote against the daily indicator snapshot ──
  // Every kind below reads lib/market-data/price-structure.ts numbers the
  // 06:30 ET job stores in TickerIndicators (completed sessions through
  // yesterday). No snapshot for the ticker → false: a missed trigger,
  // never a crash. docs/plans/AGENT_REBUILD.md §3.
  //
  // Price above / below a moving average. Until DAV-247 nothing ever
  // supplied the average, so this was false for its entire existence
  // (GD and SYK carried buy rungs that could not fire).
  | { kind: "VS_SMA"; period: SmaPeriod; direction: "ABOVE" | "BELOW" }
  // Within withinPct% of a moving average, either side — the pullback arm.
  | { kind: "NEAR_SMA"; period: SmaPeriod; withinPct: number }
  // Today's volume so far ÷ the 20-session average. No projection: a
  // morning can't look heavy until it is, so intraday this only turns true
  // once the real volume is there. Read at the close it is the day's ratio.
  | { kind: "VOLUME_RATIO"; min: number }
  // Price above the highest high of the prior 20 sessions / 52 weeks.
  | { kind: "NEW_HIGH"; window: "20D" | "52W" }
  // Price within max% of the 52-week high.
  | { kind: "PCT_FROM_52W_HIGH"; max: number }
  // Return over the window minus SPY's, in percentage points, as of the
  // last close (daily resolution).
  | { kind: "RS_VS_SPY"; window: "1M" | "3M" | "6M"; min: number }
  // Opened ≥ minPct% over the prior close on ≥ minVolRatio× average volume,
  // today or within the last withinDays sessions (default 1 = today).
  | { kind: "GAP_UP"; minPct: number; minVolRatio: number; withinDays?: number }
  // RSI over the snapshot's closes with the live price as today's close.
  // period defaults to 14; RSI(2) is the mean-reversion read (D6).
  | {
      kind: "RSI";
      period?: 2 | 14;
      threshold: number;
      direction: "ABOVE" | "BELOW";
    }
  // At least minBuyers distinct insiders bought on the open market (Form 4,
  // code P) within the last `days` (TRADING_PLAYBOOK.md D9). Reads the
  // snapshot's insiderBuys, refreshed each morning. DAV-252.
  | { kind: "INSIDER_CLUSTER"; minBuyers: number; days: number }

  // ── Calendar-based ────────────────────────────────────────────────────
  // EARNINGS_BEAT / EARNINGS_MISS are NOT signal-dependent any more. They
  // evaluate on the price cron off the published earnings calendar —
  // reported EPS against estimate, arithmetic, no router (see
  // lib/agent/triggers/earnings.ts). They spent months inert waiting on a
  // producer to stamp a surprise figure onto a Signal that never came. The
  // signal branch in evaluate.ts is kept as a fallback for a restored
  // router; it is not what fires them today.
  | { kind: "EARNINGS_BEAT"; minSurprisePct?: number }
  | { kind: "EARNINGS_MISS"; minSurprisePct?: number }
  // "This stock reports within N days." The heads-up BEFORE a report, read
  // off the same calendar call as beat/miss. A holding about to report is a
  // sizing question — trim, hold through, or don't add until after — and
  // nothing else in the ladder asks it. Fires once per approaching report
  // (30-day default cooldown ≫ the window, ≪ a quarter). Added 2026-09-10;
  // see docs/plans/MARKET_DATA.md §3.
  | { kind: "EARNINGS_WITHIN"; days: number }
  // "This stock reported between min and max days ago." The mirror of
  // EARNINGS_WITHIN, off the same calendar: the post-report window where a
  // drift trade is entered — day 1 to 3 after the print, once the reaction
  // is known. Fires once per report (30-day cooldown). Bounded above by
  // the evaluator's lookback (EARNINGS_LOOKBACK_DAYS).
  | { kind: "EARNINGS_SINCE"; min: number; max: number }
  // "This company filed something with the SEC." Keyed on the 8-K item code
  // or the form — the code IS the event (`5.02` an officer leaving, `4.02`
  // a restatement) — never on "a 10-Q was filed", which is why the old
  // FILING kind never meant anything. `tier` is "at least": MATERIAL
  // matches red too. `items` / `forms` name one event, for a thesis that
  // waits on it. Read live off EDGAR once per evaluator pass; one fire per
  // filing, keyed on the filing's ID (`firedFilings`), not a cooldown —
  // filings cluster. Never trades by itself. docs/plans/SEC_FILINGS.md.
  | {
      kind: "SEC_EVENT";
      tier?: "RED" | "MATERIAL";
      items?: string[];
      forms?: string[];
    }

  // ── Time-based — housekeeping or periodic worker ──────────────────────
  // "Look at this again every N days", counted from when it was last
  // ACTUALLY reviewed (Thesis.lastReviewedAt). Replaced REVIEW_DATE_HIT on
  // 2026-08-25, which read a date column the agent set by hand — two stores
  // of one idea, and the column was the one nothing fired on.
  //
  // Cascades like every other trigger: the account says every 7 days, an
  // analyst can say every day, one thesis can say every 3. That is the whole
  // review system; there is no separate review-date concept any more.
  //
  // A DECLINE IS NOT A REVIEW. Declining a sell proposal leaves the market
  // condition true, so that fires again — standing order, unchanged. This is
  // a clock about US, and the daily run looking at the thesis satisfies it
  // even if it concludes nothing changed. If the run skips it or crashes,
  // nothing is stamped and it stays due.
  //
  // The same rung counts from two other dates (2026-09-16, one trigger,
  // three "counting from" choices — not three kinds):
  //   from: "BUY"   — N days after the position opened; fires once the
  //                    count is reached (the playbook's time limits: "out
  //                    after 20 days with no progress", the 60-day
  //                    business checkpoint). False until held.
  //   from: "EVENT" — N days before (side: "BEFORE") or after (side:
  //                    "AFTER") the thesis's own catalystDate — the FDA
  //                    decision, the deal close. The date is read off the
  //                    thesis, never typed into the trigger, so it can't
  //                    drift from the one the thesis carries. False with
  //                    no event date.
  //   from absent / "LAST_REVIEW" — the review clock above.
  // Recurring vs once is the cooldown's job: the default cooldown equals
  // `days`, so a BUY/EVENT review re-asks every N days after it first
  // fires, and an EXIT is the usual standing order.
  | {
      kind: "REVIEW_CADENCE";
      days: number;
      from?: "LAST_REVIEW" | "BUY" | "EVENT";
      /** EVENT only. Default AFTER. */
      side?: "BEFORE" | "AFTER";
    }

  // ── Composition ───────────────────────────────────────────────────────
  | { kind: "AND"; predicates: LegacyPredicate[] }
  | { kind: "OR"; predicates: LegacyPredicate[] };
