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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Check, X, Loader2, ChevronDown, Pencil } from "lucide-react";
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
  // "Edit & Approve" — fetch the proposal's current values on open, let the
  // principal change shares (OPEN/ADD) + target/stop (OPEN), then approve with
  // the edits applied before the Alpaca submit.
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editIntent, setEditIntent] = useState<string>("OPEN");
  const [editShares, setEditShares] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [editStop, setEditStop] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  async function openEdit() {
    setEditOpen(true);
    setEditError(null);
    setEditLoading(true);
    try {
      const res = await fetch(`/api/proposals/${orderId}`);
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const ctx = (await res.json()) as {
        intent?: string;
        quantity?: number | null;
        targetPrice?: number | null;
        stopLoss?: number | null;
      };
      setEditIntent(ctx.intent ?? "OPEN");
      setEditShares(ctx.quantity != null ? String(ctx.quantity) : "");
      setEditTarget(ctx.targetPrice != null ? String(ctx.targetPrice) : "");
      setEditStop(ctx.stopLoss != null ? String(ctx.stopLoss) : "");
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
    } finally {
      setEditLoading(false);
    }
  }

  async function submitEdit() {
    setPending("approve");
    setEditError(null);
    const body: Record<string, number> = {};
    const q = Number(editShares);
    if (
      (editIntent === "OPEN" || editIntent === "ADD") &&
      Number.isFinite(q) &&
      q > 0
    ) {
      body.quantity = q;
    }
    if (editIntent === "OPEN") {
      const t = Number(editTarget);
      const s = Number(editStop);
      if (Number.isFinite(t) && t > 0) body.targetPrice = t;
      if (Number.isFinite(s) && s > 0) body.stopLoss = s;
    }
    try {
      const res = await fetch(`/api/proposals/${orderId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status !== 202) {
        throw new Error((await res.text()) || `HTTP ${res.status}`);
      }
      setEditOpen(false);
      setResolved("approved");
      router.refresh();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : String(err));
      setPending(null);
    }
  }

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
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void openEdit();
            }}
          >
            <Pencil className="size-4" />
            Edit…
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

        <Dialog
          open={editOpen}
          onOpenChange={pending === "approve" ? undefined : setEditOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit &amp; approve</DialogTitle>
              <DialogDescription>
                Adjust the order before approving. Your edits apply before it&apos;s
                submitted — the agent records the change.
              </DialogDescription>
            </DialogHeader>

            {editLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading proposal…
              </div>
            ) : editIntent === "OPEN" || editIntent === "ADD" ? (
              <div className="grid gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="proposal-edit-shares">Shares</Label>
                  <Input
                    id="proposal-edit-shares"
                    type="number"
                    inputMode="decimal"
                    value={editShares}
                    onChange={(e) => setEditShares(e.target.value)}
                    disabled={pending === "approve"}
                    autoFocus
                  />
                </div>
                {editIntent === "OPEN" ? (
                  <>
                    <div className="grid gap-1.5">
                      <Label htmlFor="proposal-edit-target">Target price</Label>
                      <Input
                        id="proposal-edit-target"
                        type="number"
                        inputMode="decimal"
                        value={editTarget}
                        onChange={(e) => setEditTarget(e.target.value)}
                        disabled={pending === "approve"}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="proposal-edit-stop">Stop price</Label>
                      <Input
                        id="proposal-edit-stop"
                        type="number"
                        inputMode="decimal"
                        value={editStop}
                        onChange={(e) => setEditStop(e.target.value)}
                        disabled={pending === "approve"}
                      />
                    </div>
                  </>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This is a {editIntent.toLowerCase().replace("_", " ")} order — its
                size isn&apos;t editable here. To change a close, reject it and adjust
                the position&apos;s stop/target on its thesis instead.
              </p>
            )}

            {editError ? (
              <p className="text-xs text-destructive">{editError}</p>
            ) : null}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setEditOpen(false)}
                disabled={pending === "approve"}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void submitEdit()}
                disabled={
                  pending === "approve" ||
                  editLoading ||
                  !(editIntent === "OPEN" || editIntent === "ADD")
                }
              >
                {pending === "approve" ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : null}
                Save &amp; approve
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
