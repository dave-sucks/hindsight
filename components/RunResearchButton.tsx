"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";

export function RunResearchButton({ hasRunning }: { hasRunning: boolean }) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/research/trigger", { method: "POST" });
      if (!res.ok) throw new Error("Request failed");
      toast.success("Research run started — results will appear in the feed shortly");
    } catch {
      toast.error("Failed to start research run. Please try again.");
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
      {hasRunning ? "Research Running…" : "Run Research Now"}
    </Button>
  );
}
