"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Feature card ───────────────────────────────────────────────────────────
// Marketing-style showcase card for empty states. Header + description on top,
// preview asset on bottom with variable padding variants.

const PREVIEW_CLASSES = {
  padded: "p-3",
  bleed: "p-0",
  offset: "pt-3 pl-3 pr-0 pb-0",
} as const;

interface FeatureCardProps {
  title: string;
  description: string;
  /** Bottom section padding variant */
  preview?: keyof typeof PREVIEW_CLASSES;
  /** Click handler for detail dialog */
  onClick?: () => void;
  /** Optional preview content (skeleton mockup, badge row, etc.) */
  children?: React.ReactNode;
}

export function FeatureCard({
  title,
  description,
  preview = "padded",
  onClick,
  children,
}: FeatureCardProps) {
  return (
    <Card
      className={cn("p-0 overflow-hidden", onClick && "cursor-pointer hover:ring-1 hover:ring-foreground/10 transition-shadow")}
      onClick={onClick}
    >
      <div className="p-3 space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {description}
        </p>
      </div>
      {children && (
        <div className={cn("aspect-[4/3] overflow-hidden", PREVIEW_CLASSES[preview])}>
          {children}
        </div>
      )}
    </Card>
  );
}

// ── Feature showcase ───────────────────────────────────────────────────────
// Groups feature cards with an optional hero headline and CTA.

interface FeatureShowcaseProps {
  headline?: string;
  subtitle?: string;
  action?: { label: string; href: string };
  children: React.ReactNode;
}

export function FeatureShowcase({ headline, subtitle, action, children }: FeatureShowcaseProps) {
  return (
    <div className="flex flex-col items-center py-12 px-4 space-y-6 max-w-2xl mx-auto">
      {(headline || subtitle) && (
        <div className="text-center space-y-1.5">
          {headline && (
            <h2 className="text-lg font-semibold">{headline}</h2>
          )}
          {subtitle && (
            <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 w-full">
        {children}
      </div>

      {action && (
        <Button asChild>
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}

// ── Skeleton line (for mini previews inside feature cards) ─────────────────

export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-2 rounded-full bg-muted"
          style={{ width: `${85 - i * 15}%` }}
        />
      ))}
    </div>
  );
}

// ── Skeleton badge row (for tool/source previews) ──────────────────────────

export function SkeletonBadges({ labels }: { labels: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.map((label) => (
        <span
          key={label}
          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground"
        >
          {label}
        </span>
      ))}
    </div>
  );
}
