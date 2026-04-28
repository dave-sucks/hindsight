"use client";

/**
 * SegmentMonitorEditor — add/remove SEARCH monitors on a podcast segment.
 *
 * Phase 1 supports search monitors (Sonar queries) only. Domain monitors
 * and API monitors come in Phase 4 once segment-aware signal routing is
 * in place. See docs/PODCAST_PLAN.md.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addSegmentMonitor,
  removeSegmentMonitor,
  type SegmentDetail,
} from "@/lib/actions/podcast.actions";

type Monitor = SegmentDetail["monitors"][number];

interface Props {
  segmentId: string;
  podcastId: string;
  initialMonitors: Monitor[];
}

export function SegmentMonitorEditor({ segmentId, initialMonitors }: Props) {
  const router = useRouter();
  const [monitors, setMonitors] = useState(initialMonitors);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [isMutating, startMutating] = useTransition();

  const handleAdd = () => {
    const trimmedName = name.trim();
    const trimmedQuery = query.trim();
    if (!trimmedName || !trimmedQuery) {
      toast.error("Name and query both required");
      return;
    }
    startMutating(async () => {
      try {
        await addSegmentMonitor(segmentId, { name: trimmedName, query: trimmedQuery });
        setName("");
        setQuery("");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to add monitor");
      }
    });
  };

  const handleRemove = (monitorId: string) => {
    startMutating(async () => {
      try {
        await removeSegmentMonitor(monitorId);
        setMonitors((prev) => prev.filter((m) => m.id !== monitorId));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to remove monitor");
      }
    });
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 shadow-none">
        <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">
          Add a search monitor
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Each monitor is a Perplexity Sonar query that runs as part of the
          segment&apos;s signal pipeline. Use them to surface stories the
          segment should always check.
        </p>
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Indie game launches"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Query
            </label>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="indie game releases this week steam"
            />
          </div>
          <Button onClick={handleAdd} disabled={isMutating}>
            {isMutating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add
          </Button>
        </div>
      </Card>

      <div className="space-y-2">
        {monitors.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground border-dashed">
            No monitors yet. Add a search query above to give the segment its
            own signal feed.
          </Card>
        ) : (
          monitors.map((m) => {
            const cfg = (m.config as { query?: string } | null) ?? {};
            return (
              <Card key={m.id} className="p-3 shadow-none">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{m.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {cfg.query ?? "(no query)"}
                    </p>
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                      {m.type} · {m.method}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemove(m.id)}
                    disabled={isMutating}
                    aria-label="Remove monitor"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
