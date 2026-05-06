import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { getEpisode } from "@/lib/actions/podcast.actions";
import type { EpisodeTranscriptItem } from "@/lib/actions/podcast.actions";
import { GenerateAudioButton } from "./GenerateAudioButton";
import { EpisodeAvatar } from "./EpisodeAvatar";

type Params = { id: string; episodeId: string };

function TranscriptBody({ transcript: t, index }: { transcript: EpisodeTranscriptItem; index: number }) {
  const sorted = [...t.citations]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.startChar - b.c.startChar);

  type Seg =
    | { kind: "text"; text: string }
    | { kind: "cite"; idx: number; url: string; claim: string };

  const segs: Seg[] = [];
  let cursor = 0;
  for (const { c, i } of sorted) {
    if (c.endChar > cursor && c.endChar <= t.plainText.length) {
      segs.push({ kind: "text", text: t.plainText.slice(cursor, c.endChar) });
      segs.push({ kind: "cite", idx: i + 1, url: c.url, claim: c.claim });
      cursor = c.endChar;
    }
  }
  if (cursor < t.plainText.length) segs.push({ kind: "text", text: t.plainText.slice(cursor) });
  if (segs.length === 0) segs.push({ kind: "text", text: t.plainText });

  return (
    <section>
      <div className="border-t" />

      {/* Sticky segment label — sticks until next segment pushes it off */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm pt-3 pb-2 relative">
        <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground leading-none">
          Segment {index + 1} · {t.segmentName}
        </p>
        {/* Gradient fade so content dissolves in from under the sticky label */}
        <div className="absolute left-0 right-0 h-10 pointer-events-none from-background to-transparent bg-gradient-to-b" style={{ top: "100%" }} />
      </div>

      <div className="pt-8 pb-10 space-y-5">
        <h2 className="text-xl font-semibold leading-snug">{t.title}</h2>

        <div className="text-base leading-[1.8] whitespace-pre-wrap">
          {segs.map((s, i) =>
            s.kind === "text" ? (
              <span key={i}>{s.text}</span>
            ) : (
              <a
                key={i}
                href={s.url}
                target="_blank"
                rel="noreferrer"
                title={s.claim}
                className="inline-flex items-center justify-center mx-0.5 px-1.5 rounded bg-muted text-muted-foreground hover:text-foreground hover:bg-accent text-[10px] font-medium tabular-nums align-middle"
              >
                [{s.idx}]
              </a>
            ),
          )}
        </div>

        {t.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-2">
            {t.citations.map((c, ci) => {
              let hostname = c.url;
              try {
                hostname = new URL(c.url).hostname.replace(/^www\./, "");
              } catch {}
              return (
                <a
                  key={ci}
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground bg-muted rounded px-2 py-0.5 tabular-nums"
                >
                  [{ci + 1}] {hostname}
                </a>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

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
