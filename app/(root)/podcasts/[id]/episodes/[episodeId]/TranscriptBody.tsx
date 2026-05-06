"use client";

import { CitedText } from "@/components/chat/CitedText";
import { SourceChipRow } from "@/components/chat/SourceChip";
import type { SourceChipData } from "@/components/chat/SourceChip";
import type { EpisodeTranscriptItem } from "@/lib/actions/podcast.actions";

function buildTextWithMarkers(
  plainText: string,
  citations: EpisodeTranscriptItem["citations"],
): string {
  if (citations.length === 0) return plainText;

  const sorted = [...citations]
    .map((c, i) => ({ c, i }))
    .sort((a, b) => a.c.startChar - b.c.startChar);

  let text = "";
  let cursor = 0;
  for (const { c, i } of sorted) {
    if (c.endChar > cursor && c.endChar <= plainText.length) {
      text += plainText.slice(cursor, c.endChar);
      text += `[${i + 1}]`;
      cursor = c.endChar;
    }
  }
  if (cursor < plainText.length) text += plainText.slice(cursor);
  return text || plainText;
}

export function TranscriptBody({
  transcript: t,
  index,
}: {
  transcript: EpisodeTranscriptItem;
  index: number;
}) {
  const markedText = buildTextWithMarkers(t.plainText, t.citations);

  const sources: SourceChipData[] = t.citations.map((c) => {
    let hostname = c.url;
    try {
      hostname = new URL(c.url).hostname.replace(/^www\./, "");
    } catch {}
    return {
      provider: hostname,
      title: c.claim,
      url: c.url,
      excerpt: c.quote,
    };
  });

  return (
    <section>
      <div className="border-t" />

      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm pt-3 pb-2 relative">
        <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground leading-none">
          Segment {index + 1} · {t.segmentName}
        </p>
        <div
          className="absolute left-0 right-0 h-10 pointer-events-none from-background to-transparent bg-gradient-to-b"
          style={{ top: "100%" }}
        />
      </div>

      <div className="pt-8 pb-10 space-y-5">
        <h2 className="text-xl font-semibold leading-snug">{t.title}</h2>

        <div className="text-base leading-[1.8] whitespace-pre-wrap">
          <CitedText text={markedText} sources={sources} />
        </div>

        {sources.length > 0 && (
          <SourceChipRow sources={sources} className="pt-2" />
        )}
      </div>
    </section>
  );
}
