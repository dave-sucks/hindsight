"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { Post } from "./types";
import { PostCard } from "./post-card";

export interface PostListProps {
  data?: {
    /** Array of blog posts to display. */
    posts?: Post[];
  };
  actions?: {
    /** Called when the read more button is clicked on a post. */
    onReadMore?: (post: Post) => void;
  };
  appearance?: {
    /** Layout variant. @default "list" */
    variant?: "list" | "grid" | "carousel" | "fullwidth";
    /** Number of columns for grid and fullwidth variants. @default 2 */
    columns?: 2 | 3 | 4;
    /** Whether to show author information on post cards. @default true */
    showAuthor?: boolean;
    /** Whether to show category labels on post cards. @default true */
    showCategory?: boolean;
  };
}

/**
 * Blog post list with list, grid, carousel, and fullwidth variants.
 */
export function PostList({ data, actions, appearance }: PostListProps) {
  const posts = data?.posts ?? [];
  const onReadMore = actions?.onReadMore;
  const variant = appearance?.variant ?? "list";
  const columns = appearance?.columns ?? 2;
  const showAuthor = appearance?.showAuthor ?? true;
  const showCategory = appearance?.showCategory ?? true;
  const [currentIndex, setCurrentIndex] = useState(0);

  // List variant
  if (variant === "list") {
    return (
      <div className="m-3 space-y-3 rounded-lg bg-card p-3">
        {posts.slice(0, 3).map((post) => (
          <PostCard
            key={post.title || post.url}
            data={{ post }}
            appearance={{ variant: "horizontal", showAuthor, showCategory }}
            actions={{ onReadMore }}
          />
        ))}
      </div>
    );
  }

  // Grid variant
  if (variant === "grid") {
    return (
      <div
        className={cn(
          "grid grid-cols-1 gap-4",
          columns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"
        )}
      >
        {posts.slice(0, 4).map((post) => (
          <PostCard
            key={post.title || post.url}
            data={{ post }}
            appearance={{
              variant: "compact",
              showImage: false,
              showAuthor,
              showCategory,
            }}
            actions={{ onReadMore }}
          />
        ))}
      </div>
    );
  }

  // Fullwidth variant
  if (variant === "fullwidth") {
    const getGridColsClass = () => {
      switch (columns) {
        case 2:
          return "sm:grid-cols-2";
        case 3:
          return "sm:grid-cols-2 lg:grid-cols-3";
        case 4:
          return "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
        default:
          return "sm:grid-cols-2";
      }
    };

    return (
      <div className="space-y-6 p-6">
        <div className={cn("grid grid-cols-1 gap-6", getGridColsClass())}>
          {posts.map((post) => (
            <PostCard
              key={post.title || post.url}
              data={{ post }}
              appearance={{ variant: "default", showAuthor, showCategory }}
              actions={{ onReadMore }}
            />
          ))}
        </div>
      </div>
    );
  }

  // Carousel variant
  const maxIndexMobile = posts.length - 1;
  const maxIndexTablet = Math.max(0, posts.length - 2);
  const maxIndexDesktop = Math.max(0, posts.length - 3);

  const prev = () => setCurrentIndex((i) => Math.max(0, i - 1));
  const next = () => setCurrentIndex((i) => i + 1);

  const isAtStart = currentIndex === 0;
  const isAtEndMobile = currentIndex >= maxIndexMobile;
  const isAtEndTablet = currentIndex >= maxIndexTablet;
  const isAtEndDesktop = currentIndex >= maxIndexDesktop;

  return (
    <div className="relative">
      <div className="overflow-hidden rounded-lg">
        {/* Mobile: 1 card */}
        <div
          className="flex transition-transform duration-300 ease-out md:hidden"
          style={{ transform: `translateX(-${currentIndex * 100}%)` }}
        >
          {posts.map((post) => (
            <div
              key={post.title || post.url}
              className="w-full shrink-0 px-0.5"
            >
              <PostCard
                data={{ post }}
                appearance={{ variant: "compact", showAuthor, showCategory }}
                actions={{ onReadMore }}
              />
            </div>
          ))}
        </div>

        {/* Tablet: 2 cards */}
        <div
          className="hidden transition-transform duration-300 ease-out md:flex lg:hidden"
          style={{ transform: `translateX(-${currentIndex * 50}%)` }}
        >
          {posts.map((post) => (
            <div
              key={post.title || post.url}
              className="w-1/2 shrink-0 px-1.5"
            >
              <PostCard
                data={{ post }}
                appearance={{ variant: "compact", showAuthor, showCategory }}
                actions={{ onReadMore }}
              />
            </div>
          ))}
        </div>

        {/* Desktop: 3 cards */}
        <div
          className="hidden transition-transform duration-300 ease-out lg:flex"
          style={{
            transform: `translateX(-${currentIndex * (100 / 3)}%)`,
          }}
        >
          {posts.map((post) => (
            <div
              key={post.title || post.url}
              className="w-1/3 shrink-0 px-1.5"
            >
              <PostCard
                data={{ post }}
                appearance={{ variant: "compact", showAuthor, showCategory }}
                actions={{ onReadMore }}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between px-2">
        <div className="flex gap-1">
          {posts.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentIndex(i)}
              aria-label={`Go to slide ${i + 1}`}
              className={cn(
                "h-1.5 cursor-pointer rounded-full transition-all",
                i === currentIndex
                  ? "w-4 bg-foreground"
                  : "w-1.5 bg-muted-foreground/30"
              )}
            />
          ))}
        </div>
        {/* Mobile navigation */}
        <div className="flex gap-1 md:hidden">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={prev}
            disabled={isAtStart}
            aria-label="Previous post"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={next}
            disabled={isAtEndMobile}
            aria-label="Next post"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {/* Tablet navigation */}
        <div className="hidden gap-1 md:flex lg:hidden">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={prev}
            disabled={isAtStart}
            aria-label="Previous post"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={next}
            disabled={isAtEndTablet}
            aria-label="Next post"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        {/* Desktop navigation */}
        <div className="hidden gap-1 lg:flex">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={prev}
            disabled={isAtStart}
            aria-label="Previous post"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={next}
            disabled={isAtEndDesktop}
            aria-label="Next post"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
