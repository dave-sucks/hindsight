/**
 * When a chat's Context should be read again.
 *
 * The agent route keeps what each message sent the model on the chat's run, before the reply is handed
 * back (lib/agent/model.ts). The /chat page read that once, when it loaded, so a chat showed Context only
 * after it was reopened. The chat now reads it again when the reply begins (the request is saved by then)
 * and when the turn ends, so a turn that fails after it started still shows what it was sent.
 */
export interface TurnState {
  /** A message is being answered. */
  running: boolean;
  /** The newest message is the assistant's: its reply has begun. */
  replying: boolean;
}

export function contextDue(prev: TurnState, next: TurnState): boolean {
  const replyBegan = next.running && next.replying && !(prev.running && prev.replying);
  const turnEnded = prev.running && !next.running;
  return replyBegan || turnEnded;
}
