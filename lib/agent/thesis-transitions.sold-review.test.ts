/**
 * DAV-308 — the post-sale review has to be able to write its answer.
 *
 * Every case here goes through `checkStatusTransition`, the function the tool
 * actually calls, NOT through `checkWatchingOptOut`. That distinction is the
 * whole bug: the RETIRED(SOLD) exemption lives in the downstream helper, the
 * early terminal gate returns first, and the existing suite stayed green
 * because it exercised the helper directly.
 */
import { checkStatusTransition, isSoldReviewWrite } from "./thesis-transitions";

/** SMMT as it stood on 2026-09-23 — sold 09-21, on that morning's review list. */
const SMMT = {
  thesisId: "cmtc1kp7o000l04ikm6kf9h1b",
  ticker: "SMMT",
  currentStatus: "RETIRED",
  retiredReason: "SOLD",
  runMode: "MORNING_PLAN",
} as const;

describe("DAV-308 — a sold stock can answer its own review", () => {
  it("lets it go: the rationale-only write the prompt asks for", () => {
    // 2026-09-23 08:02:52 ET — refused with terminal_status on main.
    expect(checkStatusTransition({ ...SMMT, changeStatus: undefined })).toBeNull();
  });

  it("puts it back on watch", () => {
    // 2026-09-23 08:02:57 ET — refused with terminal_status on main.
    expect(checkStatusTransition({ ...SMMT, changeStatus: "WATCHING" })).toBeNull();
  });
});

describe("DAV-308 — and nothing else opens", () => {
  it.each(["INVALIDATED", "ARCHIVED"] as const)(
    "still refuses %s on a sold row — that is editing history",
    (verb) => {
      const v = checkStatusTransition({ ...SMMT, changeStatus: verb });
      expect(v?.data.error).toBe("terminal_status");
    },
  );

  it.each(["DROPPED", "INVALIDATED", "REPLACED"] as const)(
    "still refuses a rationale-only write on a RETIRED/%s row",
    (reason) => {
      const v = checkStatusTransition({ ...SMMT, retiredReason: reason, changeStatus: undefined });
      expect(v?.data.error).toBe("terminal_status");
    },
  );

  it("still refuses a PASSED row", () => {
    const v = checkStatusTransition({
      ...SMMT,
      currentStatus: "PASSED",
      retiredReason: null,
      changeStatus: undefined,
    });
    expect(v?.data.error).toBe("terminal_status");
  });

  it.each(["HOLDING", "WATCHING"])("leaves %s exactly as it was", (currentStatus) => {
    expect(
      checkStatusTransition({ ...SMMT, currentStatus, retiredReason: null, changeStatus: undefined }),
    ).toBeNull();
  });

  it("leaves PROMOTED on its own rule, not the terminal one", () => {
    // A rationale-only patch on a PROMOTED row is refused for a different
    // reason and always was — pinned so this change can't be blamed for it.
    const v = checkStatusTransition({
      ...SMMT,
      currentStatus: "PROMOTED",
      retiredReason: null,
      changeStatus: undefined,
    });
    expect(v?.data.error).toBe("promoted_thesis_requires_resolution");
  });
});

describe("isSoldReviewWrite", () => {
  it("is the two answers and only those two", () => {
    expect(isSoldReviewWrite({ ...SMMT, changeStatus: undefined })).toBe(true);
    expect(isSoldReviewWrite({ ...SMMT, changeStatus: "WATCHING" })).toBe(true);
    expect(isSoldReviewWrite({ ...SMMT, changeStatus: "INVALIDATED" })).toBe(false);
    expect(isSoldReviewWrite({ ...SMMT, retiredReason: "DROPPED", changeStatus: undefined })).toBe(false);
    expect(isSoldReviewWrite({ ...SMMT, currentStatus: "HOLDING", changeStatus: undefined })).toBe(false);
  });
});
