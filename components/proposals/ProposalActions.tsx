"use client";

/**
 * ProposalActions — the single "Review" control for a pending trade proposal.
 *
 * Renders a badge-sized black button (sized to match PnlBadge) that opens a
 * dropdown with Approve / Reject. Same control everywhere a proposal shows:
 * homepage + analyst sidebar trade rows, the homepage activity feed, the
 * /trades table, the agent chat, and the thesis sheet.
 *
 * Approve fires immediately. Reject opens a dialog so the principal can
 * (optionally) type a reason the agent will read on its next run. Both
 * actions hit the existing routes:
 *   POST /api/proposals/[orderId]/approve
 *   POST /api/proposals/[orderId]/reject   body: { message?: string }
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
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
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectMessage, setRejectMessage] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);

  async function approve() {
    setPending("approve");
    try {
      const res = await fetch(`/api/proposals/${orderId}/approve`, {
        method: "POST",
      });
      // 202 = uncertain Alpaca submit; reconcile resolves it. Still a success for UI.
      if (!res.ok && res.status !== 202) {
        throw new Error((await res.text()) || `HTTP ${res.status}`);
      }
      setResolved("approved");
      router.refresh();
    } catch (err) {
      console.error(`[proposal-actions] approve ${orderId} failed:`, err);
      setPending(null);
    }
  }

  async function submitReject() {
    setPending("reject");
    setRejectError(null);
    try {
      const trimmed = rejectMessage.trim();
      const res = await fetch(`/api/proposals/${orderId}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(trimmed.length > 0 ? { message: trimmed } : {}),
      });
      if (!res.ok && res.status !== 202) {
        throw new Error((await res.text()) || `HTTP ${res.status}`);
      }
      setRejectOpen(false);
      setRejectMessage("");
      setResolved("rejected");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[proposal-actions] reject ${orderId} failed:`, err);
      setRejectError(msg);
      setPending(null);
    }
  }

  function closeRejectDialog(open: boolean) {
    if (open) {
      setRejectOpen(true);
      return;
    }
    if (pending === "reject") return; // don't allow close while submitting
    setRejectOpen(false);
    setRejectMessage("");
    setRejectError(null);
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
    <>
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
              void approve();
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
              setRejectOpen(true);
            }}
          >
            <X className="size-4" />
            Reject…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
        The Dialog renders into a portal at document.body, but React events
        from inside it still bubble through the React parent chain — which
        includes the trade-row's wrapping <Link>. Without this stop, clicking
        the textarea fires Next.js Link's onClick and navigates the page.
        stopPropagation on every event type Link could be listening to.
      */}
      <div
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Dialog open={rejectOpen} onOpenChange={closeRejectDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject proposal</DialogTitle>
              <DialogDescription>
                Optional: tell the agent why. Your message is stored as a ThesisUpdate audit row so the agent reads it on the next run and adapts.
              </DialogDescription>
            </DialogHeader>
            <Textarea
              value={rejectMessage}
              onChange={(e) => setRejectMessage(e.target.value)}
              placeholder="e.g. just broke out — reconsider adding instead of selling"
              rows={4}
              maxLength={2000}
              disabled={pending === "reject"}
              autoFocus
            />
            {rejectError ? (
              <p className="text-xs text-destructive">{rejectError}</p>
            ) : null}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => closeRejectDialog(false)}
                disabled={pending === "reject"}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void submitReject()}
                disabled={pending === "reject"}
              >
                {pending === "reject" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : null}
                Reject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
