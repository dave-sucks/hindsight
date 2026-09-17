import { isDroppedConnection, isSavedAfterSend } from "./saved-answer";

// The 2026-09-16 principal chat: the question went out at 15:37:58 UTC,
// Chrome showed "network error" partway through, and the server saved the
// finished answer at 15:38:56.
const SENT_AT = Date.parse("2026-09-16T15:37:58.000Z");
const SAVED_AT = Date.parse("2026-09-16T15:38:56.060Z");

describe("isDroppedConnection", () => {
  it("is true for the error the chat showed on 2026-09-16", () => {
    expect(isDroppedConnection("network error")).toBe(true);
  });

  it("is true for the other browsers' lost-connection errors", () => {
    for (const msg of [
      "Failed to fetch",
      "Load failed",
      "The network connection was lost.",
      "NetworkError when attempting to fetch resource.",
      "Error in body stream",
    ]) {
      expect(isDroppedConnection(msg)).toBe(true);
    }
  });

  it("is false when the server or the model refused — nothing will be saved", () => {
    expect(isDroppedConnection("Agent error: Unauthorized")).toBe(false);
    expect(isDroppedConnection("Overloaded")).toBe(false);
    expect(isDroppedConnection(undefined)).toBe(false);
    expect(isDroppedConnection({ message: "network error" })).toBe(false);
  });
});

describe("isSavedAfterSend", () => {
  it("accepts the 2026-09-16 answer, saved 58s after the question", () => {
    expect(
      isSavedAfterSend({
        savedAt: SAVED_AT,
        sentAt: SENT_AT,
        serverNow: SAVED_AT + 1_000,
        clientNow: SAVED_AT + 1_000,
      }),
    ).toBe(true);
  });

  it("rejects the previous turn's save, still in the row while this turn runs", () => {
    expect(
      isSavedAfterSend({
        savedAt: SENT_AT - 45_000,
        sentAt: SENT_AT,
        serverNow: SENT_AT + 20_000,
        clientNow: SENT_AT + 20_000,
      }),
    ).toBe(false);
  });

  it("corrects for a browser clock that runs ahead of the server", () => {
    const ahead = 90_000;
    // Browser stamps the send 90s late; the save is still after the send.
    expect(
      isSavedAfterSend({
        savedAt: SAVED_AT,
        sentAt: SENT_AT + ahead,
        serverNow: SAVED_AT + 1_000,
        clientNow: SAVED_AT + 1_000 + ahead,
      }),
    ).toBe(true);
    // Without the correction the same save would read as older than the send.
    expect(SAVED_AT < SENT_AT + ahead).toBe(true);
  });

  it("is false with no saved thread or no recorded send", () => {
    const now = SAVED_AT + 1_000;
    expect(
      isSavedAfterSend({ savedAt: null, sentAt: SENT_AT, serverNow: now, clientNow: now }),
    ).toBe(false);
    expect(
      isSavedAfterSend({ savedAt: SAVED_AT, sentAt: 0, serverNow: now, clientNow: now }),
    ).toBe(false);
  });
});
