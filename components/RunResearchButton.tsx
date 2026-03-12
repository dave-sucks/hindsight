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
      // Create a run row, then navigate to the agent UI
      const res = await fetch("/api/research/agent-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentConfigId: analystId }),
      });

      if (!res.ok) throw new Error("Failed to create run");

      const { runId } = (await res.json()) as { runId: string };
      router.push(`/runs/${runId}?agent=true`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to start research run",
      );
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
      {loading
        ? "Starting run…"
        : hasRunning
          ? "Research Running…"
          : "Run Research Now"}
    </Button>
  );
}
