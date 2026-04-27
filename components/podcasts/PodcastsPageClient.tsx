"use client";

import Link from "next/link";
import { Plus, Mic, Headphones, Loader2, MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deletePodcast,
  type PodcastListItem,
} from "@/lib/actions/podcast.actions";

function formatRelativeDays(date: Date | null): string {
  if (!date) return "Never run";
  const ms = Date.now() - new Date(date).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

function PodcastCard({
  podcast,
  onDelete,
}: {
  podcast: PodcastListItem;
  onDelete: (id: string) => void;
}) {
  const router = useRouter();
  return (
    <Link href={`/podcasts/${podcast.id}`} className="block group min-w-0">
      <Card className="group-hover:bg-muted/20 transition-colors gap-0 h-full overflow-hidden shadow-none py-0">
        <div className="p-3 flex flex-col gap-2 min-w-0">
          <div className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <Mic className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground tabular-nums">
                {podcast.segmentCount} seg · {podcast.episodeCount} ep
              </span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                className="h-6 w-6 flex items-center justify-center rounded-md hover:bg-accent/60 transition-colors text-muted-foreground shrink-0"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <MoreHorizontal className="h-4 w-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem
                  onSelect={() => router.push(`/podcasts/${podcast.id}`)}
                >
                  View detail
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => onDelete(podcast.id)}
                >
                  Delete podcast
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <h2 className="text-sm font-medium leading-tight truncate">
            {podcast.name}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed line-clamp-2">
            {podcast.description ?? <span className="text-muted-foreground/60">No description</span>}
          </p>
        </div>
        <div className="px-3 pb-3 flex items-center justify-between text-xs text-muted-foreground tabular-nums">
          <span>{podcast.cadence ?? "On demand"}</span>
          <span>{formatRelativeDays(podcast.lastRunAt)}</span>
        </div>
      </Card>
    </Link>
  );
}

function NewPodcastCard() {
  return (
    <Link href="/podcasts/new">
      <Card className="h-full border-dashed hover:bg-muted/20 transition-colors cursor-pointer shadow-none py-0">
        <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[160px] text-muted-foreground p-4">
          <div className="h-8 w-8 rounded-full border-2 border-dashed border-current flex items-center justify-center">
            <Plus className="h-4 w-4" />
          </div>
          <p className="text-sm font-medium text-foreground">New Podcast</p>
          <p className="text-xs text-center">Describe a show — we&apos;ll set up segments</p>
        </div>
      </Card>
    </Link>
  );
}

function PodcastsEmptyState() {
  return (
    <Card className="p-8 text-center border-dashed">
      <div className="flex flex-col items-center gap-3">
        <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
          <Headphones className="h-5 w-5 text-muted-foreground" />
        </div>
        <div>
          <h2 className="text-base font-semibold">No podcasts yet</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Create a podcast and we&apos;ll generate the segments. Each
            segment researches its own beat and writes a script.
          </p>
        </div>
        <Button
          variant="default"
          size="default"
          className="mt-2"
          render={<Link href="/podcasts/new" />}
        >
          <Plus className="h-4 w-4" />
          New Podcast
        </Button>
      </div>
    </Card>
  );
}

export default function PodcastsPageClient({
  podcasts,
}: {
  podcasts: PodcastListItem[];
}) {
  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const target = podcasts.find((p) => p.id === deleteTarget);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await deletePodcast(deleteTarget);
      toast.success("Podcast deleted");
      setDeleteTarget(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete podcast");
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Podcasts</h1>
        <p className="text-sm text-muted-foreground mt-1">
          AI-generated podcasts. Each show has multiple segments — each segment researches its own beat and writes a script.
        </p>
      </div>

      {podcasts.length === 0 ? (
        <PodcastsEmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {podcasts.map((p) => (
            <PodcastCard key={p.id} podcast={p} onDelete={setDeleteTarget} />
          ))}
          <NewPodcastCard />
        </div>
      )}

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete {target?.name ?? "Podcast"}</DialogTitle>
            <DialogDescription>
              This will permanently delete this podcast, all its segments, all
              segment runs, transcripts, and episodes. Audio files in storage
              are unaffected. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteTarget(null)}
              disabled={deleteLoading}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={deleteLoading}
              className="gap-2"
            >
              {deleteLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {deleteLoading ? "Deleting…" : "Delete Podcast"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
