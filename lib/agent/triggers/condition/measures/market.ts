/**
 * The market: the S&P 500's move on the day, SPY against its prior close. The
 * account's own measure: a trigger on it runs the Portfolio Manager once for
 * the account (../../market.ts), and no stock carries it.
 */

import type { MeasureDef } from "../measure";

export const market: MeasureDef = {
  id: "market",
  type: "price",
  label: "S&P move",
  account: true,
  buttons: [
    { is: "below", label: "The S&P is down", means: "the S&P 500 is down that % or more from yesterday's close" },
    { is: "above", label: "The S&P is up", means: "the S&P 500 is up that % or more from yesterday's close" },
  ],
  value: { suffix: "% on the day", placeholder: "2", range: { what: "The S&P's move", unit: "%", over: 0, max: 20 } },
  actions: ["RUN_PORTFOLIO_MANAGER"],
  rises: (c) => (c.is === "above" ? true : c.is === "below" ? false : null),
  fresh: () => ({ watch: "market", is: "below" }),
  fits: (c) => c.value != null && (c.is === "above" || c.is === "below"),
  shape: "The S&P's move is down or up a % on the day.",
};
