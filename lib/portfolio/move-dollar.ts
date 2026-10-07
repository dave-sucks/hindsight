/**
 * What a holding made or lost over a window, in dollars.
 *
 * The coverage row carries its 1D / 5D / 30D moves as PERCENTS only, which is
 * why the table could show a screen of green while the portfolio header read
 * −$423.41: a −1.16% day on an $11,718 position outweighs a +0.86% day on a
 * $9,027 one, and a column of percents can't show that. The $ mode turns each
 * of those three columns into the money it actually moved.
 *
 * Each percent is computed from the window's starting close as
 * `((current − then) / then) × 100`, so this inverts it exactly rather than
 * approximating: then = current ÷ (1 + pct/100), and the move is
 * shares × (current − then). Both inputs come from the same quote, so they
 * cannot disagree.
 *
 * ONE caveat, and it is the same one every broker has: this is today's share
 * count against the window's price move. Over 5D and 30D the position may have
 * been a different size, so it answers "what this holding's move is worth to
 * me now", not "what I booked over those days". The realized side of that
 * question is the header's `sold` figure.
 *
 * Null when there is nothing to say: a watched name holds no shares, and a
 * −100% move has no starting price to divide by.
 */
export function moveDollar(input: {
  shares: number | null;
  currentPrice: number | null;
  pct: number | null;
}): number | null {
  const { shares, currentPrice, pct } = input;
  if (shares == null || currentPrice == null || pct == null) return null;
  if (shares === 0) return null;
  const factor = 1 + pct / 100;
  if (factor === 0) return null;
  const then = currentPrice / factor;
  return shares * (currentPrice - then);
}
