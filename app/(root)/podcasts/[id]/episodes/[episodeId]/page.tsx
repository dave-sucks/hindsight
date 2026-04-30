import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, FileText, Mic } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TickerMarkdown } from "@/components/ui/ticker-markdown";
import { getEpisode } from "@/lib/actions/podcast.actions";
import { GenerateAudioButton } from "./GenerateAudioButton";

type Params = { id: string; episodeId: string };

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function statusVariant(
  status: string,
): "secondary" | "outline" | "default" | "destructive" {
  if (status === "READY") return "secondary";
  if (status === "ASSEMBLING") return "default";
  if (status === "FAILED") return "destructive";
  return "outline";
}

export default async function EpisodePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id, episodeId } = await params;
  const episode = await getEpisode(episodeId);
  if (!episode || episode.podcastId !== id) return notFound();

  const totalCitations = episode.transcripts.reduce(
    (acc, t) => acc + t.citations.length,
    0,
  );

  // Char count for cost estimate — computed server-side so the button can
  // show the estimate without an extra client fetch.
  const charCount = episode.transcripts
    .map((t) => t.plainText)
    .join("\n\n").length;

  const hasAudio = !!episode.audioUrl;
  const isAssembling = episode.status === "ASSEMBLING";

  return (
    <div className="h-[calc(100dvh-3rem)] overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 space-y-6">
        {/* Header */}
        <div className="space-y-3">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            render={<Link href={`/podcasts/${id}`} />}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to {episode.podcastName}
          </Button>

          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Mic className="h-3 w-3" />
            <span>{episode.podcastName}</span>
            <span>·</span>
            <Badge variant={statusVariant(episode.status)}>
              {isAssembling ? "Generating audio…" : episode.status}
            </Badge>
          </div>

          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold leading-tight">
              {episode.title}
            </h1>

            {/* Generate / re-generate audio */}
            {!hasAudio && !isAssembling && (
              <GenerateAudioButton
                episodeId={episodeId}
                charCount={charCount}
              />
            )}
            {isAssembling && (
              <span className="text-xs text-muted-foreground shrink-0 pt-1">
                Audio generating…
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(episode.durationSec)}
            </span>
            <span>·</span>
            <span>
              {episode.transcripts.length} segment
              {episode.transcripts.length === 1 ? "" : "s"}
            </span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3" />
              {totalCitations} citation{totalCitations === 1 ? "" : "s"}
            </span>
            <span>·</span>
            <span>{new Date(episode.createdAt).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Audio player */}
        {hasAudio && (
          <div className="rounded-md border bg-card p-4 space-y-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1.5">
              <Mic className="h-3 w-3" />
              Audio
            </p>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio
              controls
              src={episode.audioUrl!}
              className="w-full h-10"
              preload="metadata"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatDuration(episode.durationSec)}
              </span>
              <GenerateAudioButton
                episodeId={episodeId}
                charCount={charCount}
                variant="regenerate"
              />
            </div>
          </div>
        )}

        {/* Body — one section per transcript, in publish order */}
        {episode.transcripts.length === 0 ? (
          <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
            This episode has no transcripts. (They may have been deleted.)
          </div>
        ) : (
          <div className="space-y-8">
            {episode.transcripts.map((t, i) => (
              <section key={t.id} className="space-y-3">
                <div className="border-t pt-4 space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                    Segment {i + 1} · {t.segmentName}
                  </p>
                  <h2 className="text-lg font-medium leading-tight">{t.title}</h2>
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                    <Clock className="h-3 w-3" />
                    {formatDuration(t.durationSec)}
                    <span>·</span>
                    <span>
                      {t.citations.length} citation{t.citations.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>

                <div className="rounded-md border bg-card p-4 text-sm leading-relaxed whitespace-pre-wrap">
                  <TickerMarkdown>{t.plainText}</TickerMarkdown>
                </div>

                {t.citations.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium flex items-center gap-1.5">
                      <FileText className="h-3 w-3" />
                      Citations
                    </p>
                    <ol className="space-y-2">
                      {t.citations.map((c, ci) => (
                        <li key={ci} className="text-xs">
                          <div className="flex items-start gap-2">
                            <span className="text-muted-foreground tabular-nums shrink-0 mt-0.5">
                              [{ci + 1}]
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-foreground line-clamp-2">{c.claim}</p>
                              <a
                                href={c.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground mt-0.5 truncate"
                              >
                                {(() => {
                                  try {
                                    return new URL(c.url).hostname.replace(/^www\./, "");
                                  } catch {
                                    return c.url;
                                  }
                                })()}
                              </a>
                              {c.quote && (
                                <p className="text-muted-foreground/80 italic line-clamp-2 mt-0.5">
                                  &ldquo;{c.quote}&rdquo;
                                </p>
                              )}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
