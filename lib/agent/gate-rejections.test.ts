/**
 * detectGateRejection — the classifier behind gate telemetry (DAV-219).
 *
 * These tests pin the boundary that matters: a REFUSAL writes a row, the
 * app WORKING does not. The shapes here are inventoried from the real
 * tools, not invented — each protocol names its source.
 */

// The module imports prisma at load time (jest can't parse the generated
// client's import.meta). The pure functions under test never touch it.
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

import { detectGateRejection, thesisIdFromArgs, tickerFromArgs } from "./gate-rejections";

describe("detectGateRejection — the three rejection protocols", () => {
  it("protocol 1 (update_thesis): { ok: false, error: code }", () => {
    expect(
      detectGateRejection({ ok: false, error: "goalpost_moving_blocked" }),
    ).toEqual({ gateCode: "goalpost_moving_blocked" });
  });

  it("protocol 1 without a code still counts, with a null gateCode", () => {
    expect(detectGateRejection({ ok: false })).toEqual({ gateCode: null });
  });

  it('protocol 2 (record_thesis / place_trade): { status: "FAILED", note }', () => {
    expect(
      detectGateRejection({
        thesis_id: null,
        status: "FAILED",
        note: "no provenance provided",
      }),
    ).toEqual({ gateCode: null });
  });

  it("protocol 3 (manage/close_position): { success: false } uses the status as code", () => {
    expect(
      detectGateRejection({ success: false, status: "NO_POSITION" }),
    ).toEqual({ gateCode: "NO_POSITION" });
  });

  it('protocol 3 with status "FAILED" yields a null code (nothing machine-readable)', () => {
    expect(
      detectGateRejection({ success: false, status: "FAILED", message: "boom" }),
    ).toEqual({ gateCode: null });
  });
});

describe("detectGateRejection — the app working is NOT a gate", () => {
  it("NO_POSITION no-ops ride success:true and are ignored", () => {
    expect(
      detectGateRejection({ success: true, status: "NO_POSITION" }),
    ).toBeNull();
  });

  it("PROPOSED (awaiting approval) is the app working", () => {
    expect(
      detectGateRejection({ success: true, status: "PROPOSED" }),
    ).toBeNull();
  });

  it("ok:true wins even when a status string rides along", () => {
    expect(detectGateRejection({ ok: true, status: "FAILED" })).toBeNull();
  });

  it("plain success payloads and non-objects are ignored", () => {
    expect(detectGateRejection({ items: [] })).toBeNull();
    expect(detectGateRejection(null)).toBeNull();
    expect(detectGateRejection("FAILED")).toBeNull();
    expect(detectGateRejection(undefined)).toBeNull();
  });
});

describe("tickerFromArgs", () => {
  it("reads ticker or symbol, uppercased", () => {
    expect(tickerFromArgs({ ticker: "mu" })).toBe("MU");
    expect(tickerFromArgs({ symbol: "prax" })).toBe("PRAX");
  });
  it("null when neither exists", () => {
    expect(tickerFromArgs({ thesis_id: "abc" })).toBeNull();
    expect(tickerFromArgs(null)).toBeNull();
  });
});

describe("tickerFromArgs / thesisIdFromArgs — what a refusal is filed under (2026-09-25)", () => {
  it("reads the ticker off the summary when the args name a thesis, not a stock", () => {
    expect(tickerFromArgs({ thesis_id: "t1" }, "Refused update on $GD — the resulting plan is invalid (invalid_thesis_shape).")).toBe("GD");
  });
  it("the args win over the summary", () => {
    expect(tickerFromArgs({ ticker: "pltr" }, "Trade blocked: $NVDA")).toBe("PLTR");
  });
  it("no ticker anywhere is null, never a guess", () => {
    expect(tickerFromArgs({ thesis_id: "t1" }, "complete_run refused: 3 thesises need action")).toBeNull();
  });
  it("carries the thesis id when the call named one", () => {
    expect(thesisIdFromArgs({ thesis_id: "abc" })).toBe("abc");
    expect(thesisIdFromArgs({ ticker: "GD" })).toBeNull();
  });
});
