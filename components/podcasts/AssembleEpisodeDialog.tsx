"use client";

/**
 * AssembleEpisodeDialog — multi-select READY transcripts from this podcast,
 * reorder via up/down arrows, click Assemble → calls
 * createEpisodeFromTranscripts and navigates to the new episode.
 *
 * Text-only assembly (Phase 1). Audio assembly is Phase 2.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, FileText, Loader2 } from "lucide-react";

import {
  createEpisodeFromTranscripts,
  type PodcastDetail,
} from "@/lib/actions/podcast.actions";

interface TranscriptOption {
  id: string;
  title: string;
  segmentName: string;
  durationSec: number | null;
  createdAt: Date;
  status: string;
}

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

interface Props {
  podcast: PodcastDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AssembleEpisodeDialog({ podcast, open, onOpenChange }: Props) {
  const router = useRouter();
  const [pending, startSubmitting] = useTransition();
  const [title, setTitle] = useState("");
  // ordered ids — checkbox toggles add/remove from this array, ↑↓ swap entries
  const [orderedIds, setOrderedIds] = useState<string[]>([]);

  // Flatten every segment's latestTranscript into a global option list. Phase
  // 1 only carries the most-recent transcript per segment in PodcastDetail
  // — multi-transcript-per-segment selection is a follow-up. The user can
  // run a segment again to surface a fresh transcript here.
  const options: TranscriptOption[] = useMemo(() => {
    const out: TranscriptOption[] = [];
    for (const seg of podcast.segments) {
      const t = seg.latestTranscript;
      if (!t) continue;
      // Only READY transcripts can be assembled. AUDIO_READY also qualifies
      // (text-only path uses the plainText).
      const ok = t.status === "READY" || t.status === "AUDIO_READY";
      if (!ok || !t.transcriptId) continue;
      out.push({
        id: t.transcriptId,
        title: t.title,
        segmentName: seg.name,
        durationSec: t.durationSec ?? null,
        createdAt: seg.lastRunAt ?? new Date(0),
        status: t.status ?? "READY",
      });
    }
    return out;
  }, [podcast.segments]);

  const optionsById = useMemo(
    () => new Map(options.map((o) => [o.id, o])),
    [options],
  );

  const toggle = (id: string) => {
    setOrderedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const move = (id: string, dir: -1 | 1) => {
    setOrderedIds((prev) => {
      const i = prev.indexOf(id);
      if (i === -1) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const totalDuration = orderedIds.reduce(
    (acc, id) => acc + (optionsById.get(id)?.durationSec ?? 0),
    0,
  );

  const handleAssemble = () => {
    if (orderedIds.length === 0) {
      toast.error("Pick at least one transcript.");
      return;
    }
    startSubmitting(async () => {
      try {
        const result = await createEpisodeFromTranscripts(
          podcast.id,
          orderedIds,
          title.trim() || undefined,
        );
        toast.success("Episode assembled");
        onOpenChange(false);
        router.push(`/podcasts/${podcast.id}/episodes/${result.id}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to assemble");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl p-0">
        <DialogHeader className="p-4 pb-2">
          <DialogTitle>Assemble an episode</DialogTitle>
          <DialogDescription>
            Pick transcripts in this podcast, set the order, and assemble.
            Audio assembly is Phase 2 — for now this builds a viewable
            text-only episode.
          </DialogDescription>
        </DialogHeader>

        {options.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            <FileText className="h-5 w-5 mx-auto mb-2 text-muted-foreground/60" />
            No ready transcripts yet. Run a segment to produce one.
          </div>
        ) : (
          <>
            <div className="px-4 max-h-[50vh] overflow-y-auto">
              {/* Selected (in order) */}
              {orderedIds.length > 0 && (
                <div className="mb-3 space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                    Selected order
                  </p>
                  {orderedIds.map((id, i) => {
                    const opt = optionsById.get(id);
                    if (!opt) return null;
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-2 rounded-md border px-2 py-1.5"
                      >
                        <span className="text-xs text-muted-foreground tabular-nums w-6 text-center">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">
                            {opt.title}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {opt.segmentName} · {formatDuration(opt.durationSec)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => move(id, -1)}
                          disabled={i === 0}
                          title="Move up"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => move(id, 1)}
                          disabled={i === orderedIds.length - 1}
                          title="Move down"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* All available — checkboxes drive selection */}
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mt-3 mb-1">
                Available transcripts
              </p>
              <div className="space-y-1">
                {options.map((opt) => {
                  const checked = orderedIds.includes(opt.id);
                  return (
                    <label
                      key={opt.id}
                      className="flex items-center gap-3 rounded-md border px-2 py-1.5 cursor-pointer hover:bg-accent/40"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(opt.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">
                          {opt.title}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {opt.segmentName} · {formatDuration(opt.durationSec)}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Title input */}
            <div className="px-4 mt-3 space-y-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                Episode title (optional)
              </p>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`${podcast.name} — ${new Date().toISOString().slice(0, 10)}`}
              />
            </div>
          </>
        )}

        <DialogFooter className="p-4 pt-3 border-t flex items-center sm:justify-between gap-2">
          <p className="text-xs text-muted-foreground tabular-nums shrink-0">
            {orderedIds.length} segment{orderedIds.length === 1 ? "" : "s"} · {formatDuration(totalDuration)}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleAssemble}
              disabled={pending || orderedIds.length === 0}
            >
              {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {pending ? "Assembling…" : "Assemble episode"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
