"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function RunResearchButton({
  hasRunning,
  analystId,
}: {
  hasRunning: boolean;
  analystId?: string;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleClick = async () => {
    setLoading(true);
    try {
      // Start the streaming run — server creates a ResearchRun and returns run_id
      const res = await fetch("/api/research/run-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "MANUAL", agentConfigId: analystId }),
      });

      if (!res.ok || !res.body) throw new Error("Failed to start run");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      // Read until we receive run_created (has the run ID), then navigate
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (event.type === "run_created" && typeof event.run_id === "string") {
              // Navigate immediately — server continues streaming + persisting
              reader.cancel().catch(() => {});
              router.push(`/runs/${event.run_id}`);
              return;
            }
            if (event.type === "error") {
              throw new Error((event.message as string) ?? "Run failed to start");
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue; // skip malformed lines
            throw parseErr;
          }
        }
        // Safety: break after first chunk if no run_created yet
        // (run_created is always the first event)
        break outer;
      }

      reader.cancel().catch(() => {});
      toast.error("Run started but could not navigate — check Runs page");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start research run");
    } finally {
      setLoading(false);
    }
  };

  const disabled = loading || hasRunning;

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleClick}
      disabled={disabled}
      className="gap-2 shrink-0"
    >
      {loading || hasRunning ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <FlaskConical className="h-3.5 w-3.5" />
      )}
      {loading ? "Starting run…" : hasRunning ? "Research Running…" : "Run Research Now"}
    </Button>
  );
}
