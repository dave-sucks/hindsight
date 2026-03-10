"use client";

import { useState, useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { SendHorizonal } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RunMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

// ─── Main component ───────────────────────────────────────────────────────────

export default function RunChatBar({
  runId,
  initialMessages = [],
}: {
  runId: string;
  initialMessages?: RunMessage[];
}) {
  const [messages, setMessages] = useState<RunMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: RunMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch(`/api/runs/${runId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!res.body) throw new Error("No stream");

      const assistantId = `a-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "" },
      ]);

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
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content + ev.text }
                  : m
              )
            );
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          }
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          content: "Something went wrong. Please try again.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="border-t shrink-0">
      {/* Message history strip */}
      {messages.length > 0 && (
        <div className="max-h-48 overflow-y-auto px-4 pt-3 space-y-2 border-b">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`text-xs leading-relaxed ${
                m.role === "user"
                  ? "text-foreground font-medium"
                  : "text-muted-foreground"
              }`}
            >
              <span className="text-[10px] uppercase tracking-wide font-semibold mr-1.5 opacity-60">
                {m.role === "user" ? "You" : "AI"}
              </span>
              {m.content}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Input bar */}
      <div className="flex items-end gap-2 p-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this run… /cancel /size /stop /target"
          rows={1}
          className="resize-none text-sm min-h-[36px] max-h-24 leading-tight"
          disabled={sending}
        />
        <Button
          size="sm"
          className="shrink-0 h-9 w-9 p-0"
          disabled={!input.trim() || sending}
          onClick={handleSend}
        >
          <SendHorizonal className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
