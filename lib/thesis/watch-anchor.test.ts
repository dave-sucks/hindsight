/**
 * The 28 WATCHING theses as they stood on 2026-10-08, read from production.
 *
 * The shapes that matter are all here: a stamp on the first day (the common
 * case), a stamp days late, and no stamp at all.
 */
import { watchAnchorPrice } from "./watch-anchor";

describe("watchAnchorPrice", () => {
  // The common case — 20 of the 28. The CREATED row carries the live price
  // from the day the watch opened.
  it("takes the price stamped on the first day", () => {
    expect(
      watchAnchorPrice({
        startedOn: "2026-06-12",
        stamped: { on: "2026-06-12", price: 340 }, // GD
        closeOnStart: 338.4,
      }),
    ).toBe(340);
  });

  // EXEL: watched 2026-09-25, first priced event 2026-10-05. Its own ledger
  // would anchor ten days late and understate the move, so the bar wins.
  it("prefers the first day's close over a stamp that came days later", () => {
    expect(
      watchAnchorPrice({
        startedOn: "2026-09-25",
        stamped: { on: "2026-10-05", price: 58.39 },
        closeOnStart: 57.68,
      }),
    ).toBe(57.68);
  });

  // ABBV, FTNT, MA — minted 2026-09-29 by the soft-watch path, which wrote a
  // CREATED row with no price. The bar is the whole answer for these.
  it("falls back to the close when nothing was ever stamped", () => {
    expect(
      watchAnchorPrice({ startedOn: "2026-09-29", stamped: null, closeOnStart: 203.11 }),
    ).toBe(203.11);
  });

  // A late stamp still beats an empty cell when the bar is missing too.
  it("uses a late stamp when there is no bar", () => {
    expect(
      watchAnchorPrice({
        startedOn: "2026-09-26",
        stamped: { on: "2026-10-05", price: 10.29 }, // IBRX
        closeOnStart: null,
      }),
    ).toBe(10.29);
  });

  it("is null when there is nothing at all", () => {
    expect(watchAnchorPrice({ startedOn: "2026-09-29", stamped: null, closeOnStart: null })).toBeNull();
  });

  // A watch anchored at zero would divide the whole column by zero.
  it("refuses a zero or negative price from either source", () => {
    expect(
      watchAnchorPrice({ startedOn: "2026-06-12", stamped: { on: "2026-06-12", price: 0 }, closeOnStart: 338.4 }),
    ).toBe(338.4);
    expect(
      watchAnchorPrice({ startedOn: "2026-06-12", stamped: null, closeOnStart: 0 }),
    ).toBeNull();
    expect(
      watchAnchorPrice({ startedOn: "2026-06-12", stamped: null, closeOnStart: -4 }),
    ).toBeNull();
  });

  it("reads a full timestamp as its day", () => {
    expect(
      watchAnchorPrice({
        startedOn: "2026-09-29T02:47:00.000Z",
        stamped: { on: "2026-09-29T03:02:00.000Z", price: 372.51 }, // TRV
        closeOnStart: 370,
      }),
    ).toBe(372.51);
  });

  // The whole point of the column: on this book it is the difference between
  // a blank cell and "PRAX is down 14% since you started watching it".
  it("gives the watchlist its missed-opportunity number", () => {
    const anchor = watchAnchorPrice({
      startedOn: "2026-07-17",
      stamped: { on: "2026-07-17", price: 308.2 }, // PRAX
      closeOnStart: 307.9,
    })!;
    const now = 264.58;
    expect(((now - anchor) / anchor) * 100).toBeCloseTo(-14.15, 1);
  });
});
