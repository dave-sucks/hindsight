/**
 * capacity.test.ts — the run is told the analyst is full, and a buy that
 * fired into a full analyst is on the row (DAV-292, DAV-286).
 *
 * Replay: the Secular Compounder, production 2026-09-18. Limit 4; holds
 * ABT, ASML, CEG, WST. ETN's buy at $418 fired 13:45Z that day; ISRG's at
 * $383 fired 09-16 and again 09-17 16:40Z. Both tactical runs decided to
 * buy and were blocked at place_trade. Nothing said so anywhere a person or
 * the next run looks.
 */
import { buyBlockedByFull, capacityLine, isFull } from "./capacity";

const COMPOUNDER = { open: 4, max: 4, held: ["ABT", "ASML", "CEG", "WST"] };
const NOW = new Date("2026-09-18T16:00:00Z");

describe("the Secular Compounder on 2026-09-18 — 4 of 4", () => {
  it("the book line says it is full and what it holds", () => {
    expect(isFull(COMPOUNDER)).toBe(true);
    expect(capacityLine(COMPOUNDER)).toBe(
      "Positions: 4 of 4 — this analyst is FULL. place_trade will refuse any new buy until one closes. It holds $ABT, $ASML, $CEG, $WST.",
    );
  });

  it("ETN: the buy that fired that morning is on the row as a portfolio decision", () => {
    const f = buyBlockedByFull({ ticker: "ETN", status: "WATCHING", enterLastFiredAt: "2026-09-18T13:45:15.819Z" }, COMPOUNDER, NOW);
    expect(f?.text).toMatch(/\$ETN's buy fired 2026-09-18 and this analyst is full \(4 of 4: \$ABT, \$ASML, \$CEG, \$WST\)/);
    expect(f?.text).toMatch(/which held stock \$ETN would replace/);
    expect(f?.text).toMatch(/full — waiting/);
  });

  it("ISRG: fired the day before — still wants in", () => {
    expect(buyBlockedByFull({ ticker: "ISRG", status: "WATCHING", enterLastFiredAt: "2026-09-17T16:40:19.704Z" }, COMPOUNDER, NOW)).not.toBeNull();
  });

  it("BWXT: a buy that fired in June is not today's question; EME never fired", () => {
    expect(buyBlockedByFull({ ticker: "BWXT", status: "WATCHING", enterLastFiredAt: "2026-06-29T13:00:29.404Z" }, COMPOUNDER, NOW)).toBeNull();
    expect(buyBlockedByFull({ ticker: "EME", status: "WATCHING", enterLastFiredAt: null }, COMPOUNDER, NOW)).toBeNull();
  });

  it("a buy that is live now counts even with no recorded fire", () => {
    expect(buyBlockedByFull({ ticker: "NOW", status: "WATCHING", enterLiveNow: true }, COMPOUNDER, NOW)?.text).toMatch(/is live now/);
  });
});

describe("an analyst with room", () => {
  const PEAD = { open: 4, max: 6, held: ["FIVE", "IOT", "MU", "NVDA"] };
  it("says how many are free, and flags nothing", () => {
    expect(capacityLine(PEAD)).toBe("Positions: 4 of 6 — 2 free. It holds $FIVE, $IOT, $MU, $NVDA.");
    expect(buyBlockedByFull({ ticker: "AIR", status: "WATCHING", enterLastFiredAt: "2026-09-18T13:45:00Z" }, PEAD, NOW)).toBeNull();
  });
  it("no limit set = no line", () => {
    expect(capacityLine({ open: 3, max: null, held: [] })).toBeNull();
  });
});
