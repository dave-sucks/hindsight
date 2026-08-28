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

import { detectGateRejection, tickerFromArgs } from "./gate-rejections";

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
  it("SUPPRESSED decline-cooldown holds ride success:true and are ignored", () => {
    // close_position's P1-28 shape: the user said no recently; the tool
    // holds. That is a working feature, never a rejection row.
    expect(
      detectGateRejection({
        success: true,
        status: "SUPPRESSED",
        unapprovedExitCount: 3,
      }),
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
