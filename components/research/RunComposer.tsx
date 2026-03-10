"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SendHorizonal } from "lucide-react";
import type { RunMessage } from "@/components/research/RunChatBar";

// ─── Main component ───────────────────────────────────────────────────────────
// Clean full-width composer for run-scoped chat.
// Does NOT render message history — that lives in RunConversation.
// Calls onUserMessage / onAssistantToken so the parent can merge chat into the
// conversation feed alongside run events.

export default function RunComposer({
  runId,
  disabled,
  onUserMessage,
  onAssistantMessage,
  onAssistantToken,
}: {
  runId: string;
  disabled?: boolean;
  /** Called immediately when user sends — add optimistic user bubble */
  onUserMessage: (msg: RunMessage) => void;
  /** Called when a complete assistant response is received (for persistence) */
  onAssistantMessage: (msg: RunMessage) => void;
  /** Called for each streamed token to update the assistant bubble */
  onAssistantToken: (id: string, token: string) => void;
}) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || disabled) return;

    // Optimistic user message
    const userId = `u-${Date.now()}`;
    onUserMessage({ id: userId, role: "user", content: text });
    setInput("");
    setSending(true);

    // Create placeholder for assistant response
    const assistantId = `a-${Date.now()}`;
    onAssistantMessage({ id: assistantId, role: "assistant", content: "" });

    try {
      const res = await fetch(`/api/runs/${runId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!res.body) throw new Error("No stream body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (ev.type === "token" && typeof ev.text === "string") {
            onAssistantToken(assistantId, ev.text);
          }
        }
      }
    } catch {
      onAssistantToken(
        assistantId,
        "Something went wrong. Please try again."
      );
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const placeholder = disabled
    ? "Run in progress — chat available when complete"
    : "Ask about this run… /cancel /size /stop /target";

  return (
    <div className="border-t px-4 py-3 shrink-0">
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="resize-none text-sm min-h-[38px] max-h-32 leading-snug flex-1"
          disabled={sending || disabled}
        />
        <Button
          size="sm"
          className="h-9 w-9 p-0 shrink-0"
          disabled={!input.trim() || sending || disabled}
          onClick={handleSend}
        >
          <SendHorizonal className="h-3.5 w-3.5" />
        </Button>
      </div>
      {disabled && (
        <p className="text-[10px] text-muted-foreground/60 mt-1.5">
          Chat unlocks when the run finishes.
        </p>
      )}
    </div>
  );
}
