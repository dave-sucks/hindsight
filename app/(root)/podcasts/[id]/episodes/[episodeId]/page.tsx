import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { getEpisode } from "@/lib/actions/podcast.actions";
import { GenerateAudioButton } from "./GenerateAudioButton";
import { EpisodeAvatar } from "./EpisodeAvatar";
import { TranscriptBody } from "./TranscriptBody";

type Params = { id: string; episodeId: string };

export default async function EpisodePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id, episodeId } = await params;
  const episode = await getEpisode(episodeId);
  if (!episode || episode.podcastId !== id) return notFound();

  const charCount = episode.transcripts.map((t) => t.plainText).join("\n\n").length;
  const hasAudio = !!episode.audioUrl;
  const isAssembling = episode.status === "ASSEMBLING";

  return (
    <div className="h-[calc(100dvh-3rem)] overflow-y-auto">
      <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <EpisodeAvatar />
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-2xl font-semibold">{episode.title}</h1>
                {isAssembling && (
                  <Badge variant="default">Generating audio…</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">
                {new Date(episode.createdAt).toLocaleDateString()} ·{" "}
                {episode.transcripts.length} segment
                {episode.transcripts.length === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          <div className="shrink-0">
            {!hasAudio && !isAssembling && (
              <GenerateAudioButton episodeId={episodeId} charCount={charCount} />
            )}
            {isAssembling && (
              <span className="text-xs text-muted-foreground">Audio generating…</span>
            )}
          </div>
        </div>

        {/* Audio player */}
        {hasAudio && (
          <div className="mb-8 space-y-2">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls src={episode.audioUrl!} className="w-full" preload="metadata" />
            <div className="flex justify-end">
              <GenerateAudioButton episodeId={episodeId} charCount={charCount} variant="regenerate" />
            </div>
          </div>
        )}

        {/* Transcripts */}
        {episode.transcripts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transcripts in this episode.</p>
        ) : (
          <div>
            {episode.transcripts.map((t, i) => (
              <TranscriptBody key={t.id} transcript={t} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
