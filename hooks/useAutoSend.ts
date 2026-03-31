"use client";

import { useEffect, useRef } from "react";
import { useThreadRuntime } from "@assistant-ui/react";

/**
 * Auto-send a message into the current thread once.
 * Guards with useRef to prevent double-sends in StrictMode.
 */
export function useAutoSend({
  message,
  delay = 300,
}: {
  message?: string;
  delay?: number;
}) {
  const threadRuntime = useThreadRuntime();
  const hasSent = useRef(false);

  useEffect(() => {
    if (!message || hasSent.current) return;
    hasSent.current = true;
    const timer = setTimeout(() => {
      threadRuntime.append({
        role: "user",
        content: [{ type: "text", text: message }],
      });
    }, delay);
    return () => clearTimeout(timer);
  }, [message, delay, threadRuntime]);
}
