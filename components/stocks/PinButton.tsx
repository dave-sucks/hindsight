"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PinIcon } from "@/components/ui/pin-icon";
import { usePinned } from "@/hooks/usePinned";

// ─── PinButton ───────────────────────────────────────────────────────────────
// The header-level pin affordance, for the icon-button strip on the stock /
// trade / thesis surfaces. (Rows get pinning through their own kebab — see
// usePinMenuItem in components/ui/trade-row.)
//
// One icon, two states, nothing else: filled = pinned, outline = not pinned.
// Clicking flips it. State comes from the shared pin cache, so this button and
// every row menu showing the same ticker flip together.

export function PinButton({
  ticker,
  size = "icon-sm",
}: {
  ticker: string;
  /** Matches the Button size the host surface uses. */
  size?: "icon-sm" | "icon";
}) {
  const { pinned, toggle } = usePinned(ticker);
  const [, startTransition] = useTransition();
  const label = pinned ? `Unpin ${ticker}` : `Pin ${ticker}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size={size}
            aria-label={label}
            aria-pressed={pinned}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startTransition(async () => {
                const res = await toggle();
                if (!res.ok) toast.error(res.error ?? `Couldn't ${pinned ? "unpin" : "pin"} ${ticker}`);
              });
            }}
          />
        }
      >
        <PinIcon filled={pinned} />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
