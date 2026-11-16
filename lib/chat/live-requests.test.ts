import { contextDue, type TurnState } from "@/lib/chat/live-requests";

const idle: TurnState = { running: false, replying: false };
const sent: TurnState = { running: true, replying: false };
const replying: TurnState = { running: true, replying: true };

describe("when a chat's Context is read again", () => {
  it("not when the message goes out: the request is saved only as it is sent", () => {
    expect(contextDue(idle, sent)).toBe(false);
  });

  it("when the reply begins, once, and not again while it streams", () => {
    expect(contextDue(sent, replying)).toBe(true);
    expect(contextDue(replying, replying)).toBe(false);
  });

  it("when the turn ends, so a turn that failed after it went out still shows what it was sent", () => {
    expect(contextDue(replying, idle)).toBe(true);
    expect(contextDue(sent, idle)).toBe(true);
  });

  it("not while the chat sits idle, or for a reply the chat already shows", () => {
    expect(contextDue(idle, idle)).toBe(false);
    // A reopened chat ends with the assistant's message and no turn running.
    expect(contextDue(idle, { running: false, replying: true })).toBe(false);
  });

  it("a second message in the same chat reads again", () => {
    expect(contextDue(idle, sent)).toBe(false);
    expect(contextDue(sent, replying)).toBe(true);
  });
});
