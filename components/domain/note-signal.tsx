import { FlameIcon } from "@/components/ui/flame-icon";
import { cn } from "@/lib/utils";

/** What a note's effect reads as: stronger, weaker or neutral for why we own or watch the stock (every live thesis is a long). */
const EFFECT_WORDS: Record<string, string> = { stronger: "Bullish", weaker: "Bearish", neutral: "Neutral" };

/**
 * An agent note's two fields at a glance (the owner, 2026-11-13): the flame,
 * the conviction chip's own, only on a high-impact note (the one level that
 * puts the stock on its analyst's list), then Bullish, Bearish or Neutral.
 * Takes the colour of the text it sits in.
 */
export function NoteSignal({ impact, effect, className }: { impact?: string | null; effect?: string | null; className?: string }) {
  const word = effect ? (EFFECT_WORDS[effect] ?? effect) : null;
  if (impact !== "high" && !word) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", className)}>
      {impact === "high" ? <FlameIcon className="size-3" /> : null}
      {word}
    </span>
  );
}
