"use client";

/**
 * Citation — domain-specific citation component for tool results.
 * Inline chip variant with hover popover (shadcn HoverCard), or full card variant.
 */

import { cn } from "@/lib/utils";
import {
  Globe,
  FileText,
  Newspaper,
  Database,
  Code2,
  File,
  ExternalLink,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

export type CitationType =
  | "webpage"
  | "document"
  | "article"
  | "api"
  | "code"
  | "other";
export type CitationVariant = "default" | "inline";

const TYPE_ICONS: Record<CitationType, LucideIcon> = {
  webpage: Globe,
  document: FileText,
  article: Newspaper,
  api: Database,
  code: Code2,
  other: File,
};

function extractDomain(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export interface CitationProps {
  id?: string;
  href: string;
  title: string;
  snippet?: string;
  domain?: string;
  favicon?: string;
  author?: string;
  publishedAt?: string;
  type?: CitationType;
  variant?: CitationVariant;
  className?: string;
  onClick?: () => void;
}

export function Citation({
  id,
  href,
  title,
  snippet,
  domain: providedDomain,
  favicon,
  author,
  publishedAt,
  type = "webpage",
  variant = "default",
  className,
  onClick,
}: CitationProps) {
  const domain = providedDomain ?? extractDomain(href);
  const TypeIcon = TYPE_ICONS[type] ?? Globe;

  const iconElement = favicon ? (
    <img
      src={favicon}
      alt=""
      width={14}
      height={14}
      className="bg-muted size-3.5 shrink-0 rounded object-cover"
    />
  ) : (
    <TypeIcon className="size-3.5 shrink-0 opacity-60" />
  );

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (href) {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  };

  // Inline variant: compact chip with hover popover
  if (variant === "inline") {
    return (
      <HoverCard>
        <HoverCardTrigger
          openDelay={100}
          render={
            <button
              type="button"
              data-citation-id={id}
              onClick={handleClick}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-0.5",
                "bg-muted/60 text-xs outline-none",
                "transition-colors duration-150",
                "hover:bg-muted",
                className,
              )}
            />
          }
        >
          {iconElement}
          <span className="text-muted-foreground">{domain}</span>
        </HoverCardTrigger>
        <HoverCardContent side="top" className="w-64 space-y-1.5">
          <div className="flex items-start gap-2">
            {iconElement}
            <span className="text-muted-foreground text-[10px]">
              {domain}
            </span>
          </div>
          <p className="text-xs leading-snug font-medium">{title}</p>
          {snippet && (
            <p className="text-muted-foreground line-clamp-2 text-[10px] leading-relaxed">
              {snippet}
            </p>
          )}
        </HoverCardContent>
      </HoverCard>
    );
  }

  // Default variant: full card
  return (
    <article
      className={cn("relative w-full max-w-md min-w-64", className)}
      data-citation-id={id}
    >
      <div
        className={cn(
          "group relative flex w-full min-w-0 flex-col overflow-hidden rounded-xl",
          "border bg-card text-xs shadow-xs",
          "transition-colors duration-150",
          "cursor-pointer hover:border-foreground/25",
        )}
        onClick={handleClick}
        role="link"
        tabIndex={0}
      >
        <div className="flex flex-col gap-1.5 p-3">
          <div className="text-muted-foreground flex min-w-0 items-center justify-between gap-1.5 text-[10px]">
            <div className="flex min-w-0 items-center gap-1.5">
              {iconElement}
              <span className="truncate font-medium">{domain}</span>
              {(author || publishedAt) && (
                <span className="opacity-70">
                  {" — "}
                  {author}
                  {author && publishedAt && ", "}
                  {publishedAt}
                </span>
              )}
            </div>
            <ExternalLink className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          </div>

          <h3 className="text-foreground text-xs leading-snug font-medium">
            <span className="group-hover:underline group-hover:underline-offset-2 line-clamp-2">
              {title}
            </span>
          </h3>

          {snippet && (
            <p className="text-muted-foreground text-[10px] leading-relaxed line-clamp-2">
              {snippet}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
