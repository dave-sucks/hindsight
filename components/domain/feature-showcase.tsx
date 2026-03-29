"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// ── Feature card ───────────────────────────────────────────────────────────
// Showcase card for empty states. Icon + title + description + optional
// skeleton preview. Consistent pattern across all pages.

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional preview content (skeleton mockup, badge row, etc.) */
  children?: React.ReactNode;
}

export function FeatureCard({ icon: Icon, title, description, children }: FeatureCardProps) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 pt-4 pb-3 space-y-2">
        <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
            {description}
          </p>
        </div>
      </div>
      {children && (
        <div className="px-4 pb-4 pt-1">
          {children}
        </div>
      )}
    </Card>
  );
}

// ── Feature showcase ───────────────────────────────────────────────────────
// Groups feature cards with an optional hero headline and CTA.

interface FeatureShowcaseProps {
  /** Bold headline */
  headline?: string;
  /** Subtitle under headline */
  subtitle?: string;
  /** CTA button */
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
