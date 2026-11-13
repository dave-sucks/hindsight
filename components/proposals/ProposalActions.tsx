"use client";

/**
 * ProposalActions — the one answer control for a pending trade proposal.
 *
 * Two small outline buttons: Reject (an X) and a split Accept (a check, then
 * a ··· that opens Accept as is / Edit details). The same control everywhere
 * a proposal shows: the trade banner on the sheet and the trade page, and
 * the agent chat's proposal rows. The homepage holdings table and the
 * /trades table have none: their rows open a page that does. (Until
 * 2026-11-04 this was one black "Review" button opening a dropdown.)
 *
 * Accept fires immediately. Reject opens a dialog so the principal can
 * (optionally) type a reason the agent will read on its next run.
 *
 * A sale a trigger proposed (lib/proposals/sale-card.ts) is answered Sell or
 * Hold instead. Sell is Accept. Hold is the decline with, in one step, a new
 * sell line for the stock (the trigger form's own condition field, filled
 * with the recent low) or none: either way the line it broke stays quiet
 * until the stock closes back past it and breaks it again. Both actions hit
 * the existing routes:
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ConditionFields, FieldLabel } from "@/components/agent/triggers/TriggerFields";
import { conditionProblem, money, type Condition } from "@/lib/agent/triggers/condition";
import type { ThesisSaleCard } from "@/lib/types/thesis-sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Check, X, Loader2, MoreHorizontal, Pencil, Hand } from "lucide-react";
import { ButtonGroup } from "@/components/ui/button-group";
import { ThesisTriggersSection } from "@/components/agent/sheets/ThesisTriggersSection";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { EXECUTING_LABEL, EXECUTING_TOOLTIP } from "@/lib/trade-status";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export interface ProposalActionsProps {
  orderId: string;
  /**
   * ISO expiry of the proposal. Past-expiry the control renders nothing
   * instead of a Review button that can only 410 — the
   * expiry cron sweeps every 30 min, so a proposal can be dead in the DB
   * while its row still says AWAITING_APPROVAL. Omitted = unknown, render
   * the button and let the server rule.
   */
  expiresAt?: string | null;
  /** The ··· menu's alignment — "end" (default) for right-aligned rows, "start" for left. */
  align?: "start" | "end";
  /** Optional positioning class on the trigger (margins only — not styling). */
  className?: string;
  /** Accept (and its ···) as the primary button: the page card's foot (the owner, 2026-11-05). Reject stays outline. */
  accent?: boolean;
  /** A sale a trigger proposed: answered Sell or Hold. */
  sale?: SaleAnswer | null;
}

/** What Hold needs to know about a trigger's sale. */
export interface SaleAnswer extends ThesisSaleCard {
  ticker: string | null;
  quantity: number;
  direction: "LONG" | "SHORT" | null;
  /** The live price: a new line past it would sell at the next check. */
  now: number | null;
}

/** The new line Hold starts from: the stock's own sell line at the recent low. */
function startingLine(sale: SaleAnswer): Condition {
  return { watch: "price", is: sale.direction === "SHORT" ? "above" : "below", ...(sale.suggestedLine != null ? { value: sale.suggestedLine } : {}) };
}

/** A new line the stock is already past would sell at the next check, which is no Hold. */
function linePastPrice(line: Condition, sale: SaleAnswer): string | null {
  if (sale.now == null || line.watch !== "price" || line.variable || line.value == null) return null;
  const past = line.is === "below" ? sale.now < line.value : line.is === "above" ? sale.now > line.value : false;
  return past ? `${sale.ticker ?? "The stock"} is at ${money(sale.now)}, already past ${money(line.value)}: it would sell at the next check.` : null;
}

/** The proposal routes return `{ error, code }` JSON for known refusals, plain text otherwise. */
async function readApiError(
  res: Response,
): Promise<{ message: string; code?: string }> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text) as { error?: string; code?: string };
    if (body && typeof body.error === "string") {
      return { message: body.error, code: body.code };
    }
  } catch {
    /* not JSON */
  }
  return { message: text || `HTTP ${res.status}` };
}

const EXPIRED_TOAST =
  "This proposal expired before a decision landed. The analyst reads the expiry and can re-propose.";

export function ProposalActions({ orderId, expiresAt, align = "end", className, accent = false, sale = null }: ProposalActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [resolved, setResolved] = useState<
    "approved" | "rejected" | "expired" | null
  >(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectMessage, setRejectMessage] = useState("");
  const [rejectError, setRejectError] = useState<string | null>(null);
  // Inline trigger editing on reject — raise the stop, bump the target, add a
  // "down X%" alert right here, then reject with a note (TRIGGER_FOLLOWUPS #2).
  // Resolved from the proposal's paired thesis on open.
  const [rejectThesisId, setRejectThesisId] = useState<string | null>(null);
  const [rejectDirection, setRejectDirection] = useState<"LONG" | "SHORT" | null>(null);
  const [trigRefresh, setTrigRefresh] = useState(0);
  // "Edit details" — fetch the proposal's current values on open, let the
  // principal change shares (OPEN/ADD) + target/stop (OPEN), then approve with
  // the edits applied before the Alpaca submit.
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [editIntent, setEditIntent] = useState<string>("OPEN");
  const [editShares, setEditShares] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [editStop, setEditStop] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  // Hold, on a trigger's sale: with a new line (the default) or none.
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdMode, setHoldMode] = useState<"line" | "none">("line");
  const [holdLine, setHoldLine] = useState<Condition | null>(null);

  // One read of the proposal context, shared by Edit & Approve (reads
  // intent/quantity/target/stop) and Reject (reads thesisId/direction).
  async function fetchProposalCtx(): Promise<{
    intent?: string;
    quantity?: number | null;
    targetPrice?: number | null;
    stopLoss?: number | null;
    thesisId?: string | null;
    thesisDirection?: string | null;
  }> {
    const res = await fetch(`/api/proposals/${orderId}`);
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    return res.json();
  }

  async function openEdit() {
    setEditOpen(true);
    setEditError(null);
    setEditLoading(true);
    try {
      const ctx = await fetchProposalCtx();
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
        const { message, code } = await readApiError(res);
        if (code === "EXPIRED") {
          setEditOpen(false);
          setResolved("expired");
          toast.error(EXPIRED_TOAST);
          router.refresh();
          return;
        }
        setEditError(message);
        setPending(null);
        return;
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
        const { message, code } = await readApiError(res);
        if (code === "EXPIRED") {
          // DB row is still AWAITING_APPROVAL until the expiry cron sweeps
          // it, so a refresh alone would re-render the dead button — the
          // local "expired" overlay is the honest state.
          setResolved("expired");
          toast.error(EXPIRED_TOAST);
        } else if (code === "NOT_AWAITING") {
          toast.error(`Already resolved: ${message}`);
          setPending(null);
        } else {
          toast.error(`Approve failed: ${message}`);
          setPending(null);
        }
        router.refresh();
        return;
      }
      setResolved("approved");
      router.refresh();
    } catch (err) {
      console.error(`[proposal-actions] approve ${orderId} failed:`, err);
      toast.error("Approve failed — network error. Try again.");
      setPending(null);
    }
  }

  async function submitReject(line?: Condition | null) {
    setPending("reject");
    setRejectError(null);
    try {
      const trimmed = rejectMessage.trim();
      const res = await fetch(`/api/proposals/${orderId}/reject`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(trimmed.length > 0 ? { message: trimmed } : {}), ...(line ? { line } : {}) }),
      });
      if (!res.ok && res.status !== 202) {
        const { message } = await readApiError(res);
        throw new Error(message);
      }
      // The Hold landed and the new line didn't: say so, so it can be set from the trigger list.
      const body = (await res.json().catch(() => ({}))) as { lineError?: string };
      if (body.lineError) toast.error(`Held. The new line wasn't saved: ${body.lineError}`);
      setRejectOpen(false);
      setHoldOpen(false);
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

  async function openReject() {
    setRejectOpen(true);
    setRejectError(null);
    // Resolve the paired thesis so we can offer inline trigger edits. Non-fatal:
    // reject still works as a plain note if this misses.
    try {
      const ctx = await fetchProposalCtx();
      setRejectThesisId(ctx.thesisId ?? null);
      setRejectDirection(
        ctx.thesisDirection === "SHORT"
          ? "SHORT"
          : ctx.thesisDirection === "LONG"
            ? "LONG"
            : null,
      );
    } catch {
      /* non-fatal */
    }
  }

  function openHold() {
    if (!sale) return;
    setHoldMode("line");
    setHoldLine(startingLine(sale));
    setRejectMessage("");
    setRejectError(null);
    setHoldOpen(true);
  }

  function closeHold(open: boolean) {
    if (open || pending === "reject") return;
    setHoldOpen(false);
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
    setRejectThesisId(null);
    setRejectDirection(null);
  }

  // Past-expiry with no action taken yet: nothing to offer. Server stays the
  // authority — this only stops us offering a button whose every outcome is a
  // 410. No "Expired" word either: it sat where the row's P&L belongs.
  const lapsed =
    resolved == null && expiresAt != null && Date.parse(expiresAt) <= Date.now();

  if (resolved || lapsed) {
    // An approved order is not a finished thing — it is at Alpaca, waiting on
    // a fill. So this is the SAME shimmering "Executing" the trade block shows
    // once the server reports it, and the swap over the refresh is invisible.
    // It used to read "Approved" in a one-off emerald that is not the app's
    // green, as if the decision were the outcome.
    if (resolved === "approved") {
      return (
        <Tooltip>
          <TooltipTrigger
            render={<span className={cn("text-xs shimmer-text cursor-default", className)} />}
          >
            {EXECUTING_LABEL}
          </TooltipTrigger>
          <TooltipContent className="text-xs">{EXECUTING_TOOLTIP}</TooltipContent>
        </Tooltip>
      );
    }
    if (resolved !== "rejected") return null;
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>{sale ? "Held" : "Rejected"}</span>
    );
  }

  if (sale) {
    const line = holdMode === "line" ? holdLine : null;
    const past = line ? linePastPrice(line, sale) : null;
    const lineProblem = line ? (conditionProblem(line, { level: "THESIS", held: true }) ?? past) : null;
    const shares = `${sale.quantity} ${sale.quantity === 1 ? "share" : "shares"}`;
    const broken = sale.line
      ? `"${sale.line.sentence}" stays quiet until ${sale.ticker ?? "the stock"} closes back ${sale.direction === "SHORT" ? "below" : "above"} ${money(sale.line.price)} and breaks it again.`
      : "The trigger it broke stays quiet until the stock closes back past it and breaks it again.";
    return (
      <>
        {/* Two answers, in the review control's place: Hold, then Sell (primary on the page card's foot). */}
        <div
          className={cn("flex items-center gap-1.5", className)}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <Button variant="outline" size="xs" disabled={pending !== null} onClick={openHold}>
            {pending === "reject" ? <Loader2 className="animate-spin" /> : <Hand />}
            Hold
          </Button>
          <Button variant={accent ? "default" : "outline"} size="xs" disabled={pending !== null} onClick={() => void approve()}>
            {pending === "approve" ? <Loader2 className="animate-spin" /> : <Check />}
            Sell
          </Button>
        </div>
        <div
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Dialog open={holdOpen} onOpenChange={closeHold}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Hold{sale.ticker ? ` ${sale.ticker}` : ""}</DialogTitle>
                <DialogDescription>
                  Keep your {shares}. {broken}
                </DialogDescription>
              </DialogHeader>
              <RadioGroup value={holdMode} onValueChange={(v) => setHoldMode(v === "none" ? "none" : "line")}>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="line" id="hold-line" disabled={pending === "reject"} />
                  <Label htmlFor="hold-line">Hold with a new line</Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="none" id="hold-none" disabled={pending === "reject"} />
                  <Label htmlFor="hold-none">Hold, no new line</Label>
                </div>
              </RadioGroup>
              {line ? (
                <div className="space-y-1.5">
                  <FieldLabel>Sell if</FieldLabel>
                  <ConditionFields condition={line} onChange={setHoldLine} ctx={{ level: "THESIS", held: true }} disabled={pending === "reject"} />
                  {past ? (
                    <p className="text-xs text-muted-foreground">{past}</p>
                  ) : lineProblem ? null : (
                    <p className="text-xs text-muted-foreground">
                      {sale.suggestedLine != null ? `Filled in at the 20-day ${sale.direction === "SHORT" ? "high" : "low"}. ` : ""}
                      It becomes {sale.ticker ?? "the stock"}&apos;s sell line and asks the next time the stock breaks it.
                    </p>
                  )}
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="hold-note">Note to the analyst (optional)</Label>
                <Textarea
                  id="hold-note"
                  value={rejectMessage}
                  onChange={(e) => setRejectMessage(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  disabled={pending === "reject"}
                />
              </div>
              {rejectError ? <p className="text-xs text-destructive">{rejectError}</p> : null}
              <DialogFooter>
                <Button variant="outline" onClick={() => closeHold(false)} disabled={pending === "reject"}>
                  Cancel
                </Button>
                <Button onClick={() => void submitReject(line)} disabled={pending === "reject" || lineProblem != null}>
                  {pending === "reject" ? <Loader2 className="size-3 animate-spin" /> : null}
                  Hold
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Two small outline controls (the owner's design, 2026-11-04): Reject with its X, then a split
          Accept — the check accepts as proposed, the ··· opens Accept as is / Edit details. The
          group joins them with one full-height border, the app's ButtonGroup, never a hand-made seam. */}
      <div
        className={cn("flex items-center gap-1.5", className)}
        onClick={(e) => {
          // Trade rows are wrapped in a Link — don't navigate when answering a proposal.
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <Button
          variant="outline"
          size="xs"
          disabled={pending !== null}
          aria-label="Reject proposal"
          onClick={() => void openReject()}
        >
          {pending === "reject" ? <Loader2 className="animate-spin" /> : <X />}
          Reject
        </Button>
        <ButtonGroup>
          <Button
            variant={accent ? "default" : "outline"}
            size="xs"
            disabled={pending !== null}
            aria-label="Accept proposal"
            onClick={() => void approve()}
          >
            {pending === "approve" ? <Loader2 className="animate-spin" /> : <Check />}
            Accept
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant={accent ? "default" : "outline"} size="icon-xs" disabled={pending !== null} aria-label="More ways to accept" />}
            >
              <MoreHorizontal />
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
                Accept as is
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void openEdit();
                }}
              >
                <Pencil className="size-4" />
                Edit details…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ButtonGroup>
      </div>

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
            </DialogHeader>
            {/* The app's form field: label over input, `space-y-2` between —
                the same shape InputField and the other dialogs use. This was a
                DialogDescription paragraph explaining the field in prose, with
                a stored field name in it. */}
            <div className="space-y-2">
              <Label htmlFor="reject-note">Note to the analyst (optional)</Label>
              <Textarea
                id="reject-note"
                value={rejectMessage}
                onChange={(e) => setRejectMessage(e.target.value)}
                placeholder="e.g. just broke out — reconsider adding instead of selling"
                rows={4}
                maxLength={2000}
                disabled={pending === "reject"}
                autoFocus
              />
            </div>

            {/* Inline trigger editor — adjust the stop/target or add a "down X%"
                alert without leaving the dialog. Edits persist immediately via
                the trigger routes; the reject note is sent on Reject. */}
            {rejectThesisId ? (
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Adjust triggers (optional)
                </p>
                <div className="max-h-64 overflow-y-auto">
                  <ThesisTriggersSection
                    thesisId={rejectThesisId}
                    editable
                    editableOnly
                    direction={rejectDirection}
                    refreshKey={trigRefresh}
                    onChanged={() => setTrigRefresh((k) => k + 1)}
                  />
                </div>
              </div>
            ) : null}

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
