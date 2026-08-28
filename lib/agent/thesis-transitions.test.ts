/**
 * thesis-transitions — the status law, testable one rule at a time
 * (DAV-210 slice 1).
 *
 * Before the extraction these rules were six if-blocks inside
 * update_thesis's 2,000-line execute body: exercising ONE of them meant
 * booting the whole tool with a mocked prisma, quote fetch, and trigger
 * resolver. These tests are the point of the extraction — every legal
 * and illegal (status, verb, role) combination as a plain function call.
 *
 * Two of these cases are pinned production incidents:
 *   - the writer's status-less refresh on PROMOTED must PASS (the
 *     CRWD/CEG promotion burn, 2026-08-11: two over-eager guards
 *     composed to make every writer refresh structurally impossible)
 *   - the writer's status flip on PROMOTED must FAIL (2026-05-26:
 *     three writer refreshes flipped PROMOTED → WATCHING and required
 *     manual revert)
 */

import {
  checkStatusTransition,
  checkTerminateWithoutClose,
  checkWatchingOptOut,
  needsPairedCloseCheck,
  type TransitionInput,
} from "./thesis-transitions";

function input(over: Partial<TransitionInput> = {}): TransitionInput {
  return {
    thesisId: "t-1",
    ticker: "MU",
    currentStatus: "WATCHING",
    changeStatus: undefined,
    runMode: "MORNING_PLAN",
    ...over,
  };
}

describe("checkStatusTransition — terminal rows are history", () => {
  it.each(["PASSED", "RETIRED"])("refuses any update on %s", (status) => {
    const v = checkStatusTransition(input({ currentStatus: status }));
    expect(v?.data.error).toBe("terminal_status");
    expect(v?.data.current_status).toBe(status);
  });

  it.each(["WATCHING", "HOLDING"])(
    "allows content-only updates on %s",
    (status) => {
      // PROMOTED is deliberately absent: a content-only patch there is
      // refused for orchestrators (the resolution rule, tested below).
      expect(checkStatusTransition(input({ currentStatus: status }))).toBeNull();
    },
  );
});

describe("checkStatusTransition — the PROMOTED state machine", () => {
  it("writer flipping status on PROMOTED is refused (the 2026-05-26 AVGO/MRVL/TSM incident)", () => {
    const v = checkStatusTransition(
      input({
        currentStatus: "PROMOTED",
        runMode: "THESIS_WRITER",
        changeStatus: "WATCHING",
      }),
    );
    expect(v?.data.error).toBe("thesis_writer_cannot_change_promoted_status");
  });

  it("writer's status-LESS research refresh on PROMOTED passes (the CRWD/CEG burn fix)", () => {
    // Before 2026-08-13, the resolution guard also fired on the writer's
    // status-less call — every writer refresh on PROMOTED was impossible.
    expect(
      checkStatusTransition(
        input({
          currentStatus: "PROMOTED",
          runMode: "THESIS_WRITER",
          changeStatus: undefined,
        }),
      ),
    ).toBeNull();
  });

  it.each(["INVALIDATED", "ARCHIVED"] as const)(
    "killing a PROMOTED thesis via %s is refused — WATCHING is the only opt-out",
    (verb) => {
      const v = checkStatusTransition(
        input({ currentStatus: "PROMOTED", changeStatus: verb }),
      );
      expect(v?.data.error).toBe("promoted_thesis_illegal_transition");
      expect(v?.data.attempted).toBe(verb);
    },
  );

  it("an orchestrator's content-only patch on PROMOTED is refused — resolution is mandatory", () => {
    const v = checkStatusTransition(
      input({ currentStatus: "PROMOTED", changeStatus: undefined }),
    );
    expect(v?.data.error).toBe("promoted_thesis_requires_resolution");
  });

  it("the PROMOTED → WATCHING opt-out passes for orchestrators", () => {
    expect(
      checkStatusTransition(
        input({ currentStatus: "PROMOTED", changeStatus: "WATCHING" }),
      ),
    ).toBeNull();
  });

  it("rule order: the writer role gate wins over the illegal-transition gate", () => {
    // A writer attempting INVALIDATED on PROMOTED trips BOTH conditions;
    // the agent must see the role message (it explains the writer's job),
    // not the generic illegal-transition one. Same order as the inline code.
    const v = checkStatusTransition(
      input({
        currentStatus: "PROMOTED",
        runMode: "THESIS_WRITER",
        changeStatus: "INVALIDATED",
      }),
    );
    expect(v?.data.error).toBe("thesis_writer_cannot_change_promoted_status");
  });
});

describe("checkTerminateWithoutClose — the zombie-position rule", () => {
  const holdingKill = input({
    currentStatus: "HOLDING",
    changeStatus: "INVALIDATED",
  });
  const openPos = { id: "p-1", direction: "LONG", quantity: 13 };

  it("needsPairedCloseCheck gates the DB queries to exactly the HOLDING+kill case", () => {
    expect(needsPairedCloseCheck(holdingKill)).toBe(true);
    expect(
      needsPairedCloseCheck(
        input({ currentStatus: "HOLDING", changeStatus: "ARCHIVED" }),
      ),
    ).toBe(true);
    // WATCHING has no position by definition; content patches change nothing.
    expect(
      needsPairedCloseCheck(
        input({ currentStatus: "WATCHING", changeStatus: "INVALIDATED" }),
      ),
    ).toBe(false);
    expect(
      needsPairedCloseCheck(input({ currentStatus: "HOLDING" })),
    ).toBe(false);
  });

  it("refuses the kill when a position is open and no close fired this run (GOOGL/TSM/AMZN)", () => {
    const v = checkTerminateWithoutClose(holdingKill, {
      openPosition: openPos,
      closedThisRun: false,
    });
    expect(v?.data.error).toBe("terminate_active_without_close");
    expect(v?.data.position).toEqual(openPos);
  });

  it("passes when close_position already fired on this ticker in this run", () => {
    expect(
      checkTerminateWithoutClose(holdingKill, {
        openPosition: openPos,
        closedThisRun: true,
      }),
    ).toBeNull();
  });

  it("passes when there is no open position", () => {
    expect(
      checkTerminateWithoutClose(holdingKill, {
        openPosition: null,
        closedThisRun: false,
      }),
    ).toBeNull();
  });
});

describe("checkWatchingOptOut — WATCHING is reserved for the PROMOTED exit", () => {
  it.each(["WATCHING", "HOLDING"])(
    "refuses change_status WATCHING from %s",
    (status) => {
      const v = checkWatchingOptOut(
        input({ currentStatus: status, changeStatus: "WATCHING" }),
      );
      expect(v?.data.error).toBe("watching_transition_from_non_promoted");
    },
  );

  it("passes from PROMOTED, and ignores every other verb", () => {
    expect(
      checkWatchingOptOut(
        input({ currentStatus: "PROMOTED", changeStatus: "WATCHING" }),
      ),
    ).toBeNull();
    expect(
      checkWatchingOptOut(
        input({ currentStatus: "WATCHING", changeStatus: "INVALIDATED" }),
      ),
    ).toBeNull();
  });
});
