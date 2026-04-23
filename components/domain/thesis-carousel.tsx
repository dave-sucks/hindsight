"use client";

/**
 * ThesisCarousel — horizontally scrollable carousel of ThesisMiniCards.
 *
 * Used in the agent run thread to group every record_thesis call from a
 * single agent turn into one widget instead of N stacked full ThesisCards.
 * Wraps the ShadCN/embla Carousel primitive — drag to scroll, and slides
 * snap to start.
 */

import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { ThesisMiniCard } from "@/components/domain/thesis-mini-card";
import type { ThesisCardData } from "@/components/domain";

export function ThesisCarousel({ theses }: { theses: ThesisCardData[] }) {
  if (theses.length === 0) return null;

  // Basis sized so the next card always peeks past the edge — combined with
  // the right-side gradient fade, the scroll affordance is unambiguous
  // without relying on arrows (which overlap content inside a chat thread).
  // Mobile: ~1 1/4 visible. Tablet: ~2 1/4. Desktop: ~2 2/3.
  return (
    <div className="relative py-1">
      <Carousel opts={{ align: "start" }}>
        <CarouselContent className="-ml-2">
          {theses.map((thesis, i) => (
            <CarouselItem
              key={`${thesis.ticker}-${i}`}
              className="basis-[80%] sm:basis-[45%] md:basis-[38%] pl-2"
            >
              <div className="p-1">
                <ThesisMiniCard thesis={thesis} />
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>

        {/* Right-edge gradient fade implies more content off-screen. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent"
        />
      </Carousel>
    </div>
  );
}
