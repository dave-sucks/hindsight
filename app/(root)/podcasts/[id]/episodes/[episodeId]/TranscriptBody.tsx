"use client";

import { SourceChipRow } from "@/components/chat/SourceChip";
import type { SourceChipData } from "@/components/chat/SourceChip";
import type { EpisodeTranscriptItem } from "@/lib/actions/podcast.actions";

export function TranscriptBody({
  transcript: t,
  index,
}: {
  transcript: EpisodeTranscriptItem;
  index: number;
}) {
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
          {t.plainText}
        </div>

        {sources.length > 0 && (
          <SourceChipRow sources={sources} className="pt-2" />
        )}
      </div>
    </section>
  );
}

