import { Clock } from "lucide-react";
import { reviewClockLabel } from "@/lib/agent/triggers/review-clock";

/**
 * Whether this name is on a review schedule — one small icon, nothing when
 * it isn't (DAV-225). Not a badge and not a tier label: a clock is a fact
 * about a name, not a rank, and having none is the ordinary case.
 */
export function ReviewClockIcon({ days }: { days: number | null }) {
  if (days == null) return null;
  return (
    <span
      className="inline-flex items-center text-muted-foreground"
      title={`${reviewClockLabel(days)} — on a review schedule`}
    >
      <Clock className="h-3.5 w-3.5" aria-hidden />
      <span className="sr-only">{reviewClockLabel(days)}</span>
    </span>
  );
}
