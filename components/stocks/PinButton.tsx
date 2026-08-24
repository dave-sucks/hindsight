"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pin } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { setPinnedTicker } from "@/lib/actions/pins.actions";

// ─── PinButton ───────────────────────────────────────────────────────────────
// The one pin affordance. Toggles a ticker on/off the dashboard's Pinned rail
// from wherever a name appears — the stock page header, the coverage table.
// Optimistic: the icon flips immediately and reverts if the write is refused
// (not signed in, or the pin cap is full).

export function PinButton({
  ticker,
  pinned,
  size = "icon-sm",
}: {
  ticker: string;
  pinned: boolean;
  /** Matches the Button size the host surface uses. */
  size?: "icon-sm" | "icon";
}) {
  const router = useRouter();
  const [isPinned, setIsPinned] = useState(pinned);
  const [, startTransition] = useTransition();

  const toggle = (e: React.MouseEvent) => {
    // Coverage-table rows are clickable — a pin click must not also open the
    // thesis sheet behind it.
    e.preventDefault();
    e.stopPropagation();
    const next = !isPinned;
    setIsPinned(next);
    startTransition(async () => {
      const res = await setPinnedTicker(ticker, next);
      if (!res.ok) {
        setIsPinned(!next);
        toast.error(res.error ?? `Couldn't ${next ? "pin" : "unpin"} ${ticker}`);
        return;
      }
      router.refresh();
    });
  };

  // One icon in two states, not two icons — a struck-through PinOff reads as
  // a broken glyph at this size. Pinned is the filled/solid treatment.
  const label = isPinned ? `Unpin ${ticker}` : `Pin ${ticker}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size={size} aria-label={label} onClick={toggle} />
        }
      >
        <Pin className={isPinned ? "fill-current" : undefined} />
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}
