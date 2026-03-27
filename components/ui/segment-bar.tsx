import { cn } from '@/lib/utils';

/**
 * Unified segment bar — tall, skinny segments with rounded caps.
 * Used for: analyst consensus, win rate, target progress, trade table targets.
 *
 * @param segments - Total number of segments
 * @param filled - Number of filled segments (from left)
 * @param fillColor - Color class for filled segments (default: bg-positive)
 * @param emptyColor - Color class for empty segments (default: bg-muted)
 * @param height - Tailwind height class (default: h-3)
 */

type SegmentBarProps = {
  segments?: number;
  filled: number;
  fillColor?: string;
  emptyColor?: string;
  height?: string;
  className?: string;
};

export function SegmentBar({
  segments = 10,
  filled,
  fillColor = 'bg-positive',
  emptyColor = 'bg-muted',
  height = 'h-3',
  className,
}: SegmentBarProps) {
  const clamped = Math.max(0, Math.min(segments, Math.round(filled)));

  return (
    <div className={cn('flex gap-[2px]', className)}>
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'flex-1 rounded-sm',
            height,
            i < clamped ? fillColor : emptyColor,
          )}
        />
      ))}
    </div>
  );
}

/**
 * Multi-color segment bar for sentiment/distribution displays.
 * Each segment has its own color based on the ranges provided.
 *
 * @param total - Total segments to render
 * @param ranges - Array of { count, color } objects rendered left to right
 * @param height - Tailwind height class (default: h-3)
 */

type SentimentRange = { count: number; color: string };

type SentimentBarProps = {
  total: number;
  ranges: SentimentRange[];
  height?: string;
  className?: string;
};

export function SentimentBar({
  total,
  ranges,
  height = 'h-3',
  className,
}: SentimentBarProps) {
  if (total === 0) return null;

  // Build color array from ranges
  const colors: string[] = [];
  for (const range of ranges) {
    for (let i = 0; i < range.count; i++) {
      colors.push(range.color);
    }
  }
  // Pad with muted if ranges don't cover total
  while (colors.length < total) {
    colors.push('bg-muted');
  }

  return (
    <div className={cn('flex gap-[2px]', className)}>
      {colors.slice(0, total).map((color, i) => (
        <div
          key={i}
          className={cn('flex-1 rounded-sm', height, color)}
        />
      ))}
    </div>
  );
}
