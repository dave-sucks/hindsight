"use client";

/**
 * InlineCitation — adapted from vercel/ai-elements.
 * Simple inline citation badges with hover tooltip.
 * Uses Popover (Base UI) for hover cards.
 */

import { cn } from "@/lib/utils";
import { ExternalLinkIcon, GlobeIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export type InlineCitationProps = ComponentProps<"span">;

export const InlineCitation = ({
  className,
  ...props
}: InlineCitationProps) => (
  <span
    className={cn("group inline items-center gap-1", className)}
    {...props}
  />
);

export type InlineCitationTextProps = ComponentProps<"span">;

export const InlineCitationText = ({
  className,
  ...props
}: InlineCitationTextProps) => (
  <span
    className={cn("transition-colors group-hover:bg-accent rounded-sm", className)}
    {...props}
  />
);

export interface InlineCitationBadgeProps {
  index?: number;
  label?: string;
  title?: string;
  url?: string;
  domain?: string;
  snippet?: string;
  className?: string;
}

export const InlineCitationBadge = ({
  index,
  label,
  title,
  url,
  domain,
  snippet,
  className,
}: InlineCitationBadgeProps) => {
  const [showPopover, setShowPopover] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);

  const displayLabel = label ?? (index != null ? `${index}` : "?");

  const handleMouseEnter = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setShowPopover(true), 100);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setShowPopover(false), 150);
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleClick = () => {
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <span
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "ml-0.5 inline-flex items-center rounded-full bg-secondary px-1.5 py-0 text-[10px] font-medium text-secondary-foreground align-super cursor-pointer hover:bg-secondary/80 transition-colors",
          className,
        )}
      >
        {displayLabel}
      </button>
      {showPopover && (title || snippet) && (
        <div
          className="absolute bottom-full left-0 mb-1 z-50 w-64 rounded-lg bg-popover p-3 shadow-md ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px]">
              <GlobeIcon className="size-3 shrink-0" />
              <span className="truncate">
                {domain ?? (url ? (() => { try { return new URL(url).hostname; } catch { return "unknown"; } })() : "unknown")}
              </span>
              {url && <ExternalLinkIcon className="size-2.5 shrink-0 ml-auto" />}
            </div>
            {title && (
              <p className="text-xs font-medium leading-snug truncate">{title}</p>
            )}
            {snippet && (
              <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
                {snippet}
              </p>
            )}
          </div>
        </div>
      )}
    </span>
  );
};
