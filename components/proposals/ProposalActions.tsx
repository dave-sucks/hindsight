"use client";

/**
 * ProposalActions — the single "Review" control for a pending trade proposal.
 *
 * Renders a badge-sized black button (sized to match PnlBadge) that opens a
 * dropdown with Approve / Reject. Same control everywhere a proposal shows:
 * homepage + analyst sidebar trade rows, the homepage activity feed, the
 * /trades table, the agent chat, and the thesis sheet.
 *
 * Both actions hit the existing routes:
 *   POST /api/proposals/[orderId]/approve
 *   POST /api/proposals/[orderId]/reject
 *
 * On success the page server-refreshes so every other surface showing the
 * same Order picks up the new state; local `resolved` hides the control
 * immediately to prevent a double-submit.
 *
 * See docs/plans/TRADE_AS_PROPOSAL.md §6.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Check, X, Loader2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProposalActionsProps {
  orderId: string;
  /** Dropdown alignment — "end" (default) for right-aligned rows, "start" for left. */
  align?: "start" | "end";
  /** Optional positioning class on the trigger (margins only — not styling). */
  className?: string;
}

export function ProposalActions({ orderId, align = "end", className }: ProposalActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [resolved, setResolved] = useState<"approved" | "rejected" | null>(null);

  async function run(kind: "approve" | "reject") {
    setPending(kind);
    try {
      const res = await fetch(`/api/proposals/${orderId}/${kind}`, {
        method: "POST",
        ...(kind === "reject"
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify({}) }
          : {}),
      });
      // 202 = uncertain Alpaca submit; reconcile resolves it. Still a success for UI.
      if (!res.ok && res.status !== 202) {
        throw new Error((await res.text()) || `HTTP ${res.status}`);
      }
      setResolved(kind === "approve" ? "approved" : "rejected");
      router.refresh();
    } catch (err) {
      console.error(`[proposal-actions] ${kind} ${orderId} failed:`, err);
      setPending(null);
    }
  }

  if (resolved) {
    return (
      <span
        className={cn(
          "text-xs tabular-nums",
          resolved === "approved" ? "text-emerald-500" : "text-muted-foreground",
          className,
        )}
      >
        {resolved === "approved" ? "Approved" : "Rejected"}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={pending !== null}
            aria-label="Review proposal"
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium bg-foreground text-background transition-opacity hover:opacity-90 disabled:opacity-50",
              className,
            )}
            onClick={(e) => {
              // Trade rows are wrapped in a Link — don't navigate when opening the menu.
              e.preventDefault();
              e.stopPropagation();
            }}
          />
        }
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : null}
        Review
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} sideOffset={4}>
        <DropdownMenuItem
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void run("approve");
          }}
        >
          <Check className="size-4" />
          Approve
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void run("reject");
          }}
        >
          <X className="size-4" />
          Reject
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
