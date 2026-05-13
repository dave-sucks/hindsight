"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  getPromotionPreview,
  promoteAnalystToLive,
  demoteAnalystToPaper,
  closeAllLivePositionsAndDemote,
  type PromotionPreview,
} from "@/lib/actions/promote-analyst.actions";
import { useRouter } from "next/navigation";

export function PromoteAnalystDialog({
  analystId,
  open,
  onOpenChange,
}: {
  analystId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<PromotionPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");
  const [maxPosition, setMaxPosition] = useState<string>("");
  const [submitting, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;
    setConfirmName("");
    setLoadError(null);
    setPreview(null);
    getPromotionPreview(analystId).then((result) => {
      if ("error" in result) {
        setLoadError(result.error);
      } else {
        setPreview(result);
        setMaxPosition(String(result.realMaxPosition));
      }
    });
  }, [open, analystId]);

  if (!preview && !loadError) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[460px]">
          <div className="py-8 flex items-center justify-center text-sm text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (loadError) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Couldn&apos;t load analyst</DialogTitle>
            <DialogDescription>{loadError}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (preview!.currentEnvironment === "LIVE") {
    return (
      <DemoteBody
        preview={preview!}
        submitting={submitting}
        startTransition={startTransition}
        onClose={() => onOpenChange(false)}
        onSuccess={() => {
          onOpenChange(false);
          router.refresh();
        }}
      />
    );
  }

  // ─── PROMOTE ────────────────────────────────────────────────────────────
  const canConfirm =
    preview!.liveCredsVerified &&
    confirmName.trim() === preview!.analystName.trim();

  function handlePromote() {
    const capValue = Number.parseFloat(maxPosition);
    const parsedCap = Number.isFinite(capValue) && capValue > 0 ? capValue : undefined;
    startTransition(async () => {
      const result = await promoteAnalystToLive(analystId, {
        realMaxPosition: parsedCap,
      });
      if (result.ok) {
        toast.success(
          result.closed > 0
            ? `Promoted to live. Closed ${result.closed} paper position${result.closed === 1 ? "" : "s"}.`
            : "Promoted to live.",
        );
        onOpenChange(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Promote {preview!.analystName} to Live
            <Badge variant="destructive">LIVE</Badge>
          </DialogTitle>
          <DialogDescription>
            This analyst will start placing real-money trades using your live
            Alpaca account. New entries from this moment forward are live.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!preview!.liveCredsVerified && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-destructive">Live Alpaca key not connected</p>
                <p className="text-muted-foreground mt-0.5">
                  Add your live Alpaca credentials in Settings, then come back to promote.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Open paper positions</Label>
            {preview!.openPaperPositions.length === 0 ? (
              <p className="text-xs text-muted-foreground">None — promotion is a clean start.</p>
            ) : (
              <div className="rounded-md border divide-y text-xs">
                {preview!.openPaperPositions.map((p) => (
                  <div key={p.id} className="flex justify-between px-3 py-1.5">
                    <span className="tabular-nums">{p.symbol}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {p.direction} {p.quantity} @ ${p.avgCost.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {preview!.openPaperPositions.length > 0 && (
              <p className="text-xs text-muted-foreground">
                These will be closed at market in the paper account. The theses stay
                active — the agent re-evaluates each one at current prices on its
                next live run.
              </p>
            )}
          </div>

          <Separator />

          <div className="space-y-1.5">
            <Label htmlFor="promote-max-position" className="text-xs">
              Live per-position cap ($)
            </Label>
            <Input
              id="promote-max-position"
              type="number"
              min={1}
              value={maxPosition}
              onChange={(e) => setMaxPosition(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Hard ceiling on any single live order. Start small for the first week.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="promote-confirm" className="text-xs">
              Type <span className="tabular-nums">{preview!.analystName}</span> to confirm
            </Label>
            <Input
              id="promote-confirm"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={preview!.analystName}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!canConfirm || submitting}
            onClick={handlePromote}
            className="gap-2"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitting ? "Promoting…" : "Promote to Live"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DemoteBody({
  preview,
  submitting,
  startTransition,
  onClose,
  onSuccess,
}: {
  preview: PromotionPreview;
  submitting: boolean;
  startTransition: (cb: () => void) => void;
  onClose: () => void;
  onSuccess: () => void;
}) {
  function handleSimpleDemote() {
    startTransition(async () => {
      const result = await demoteAnalystToPaper(preview.analystId);
      if (result.ok) {
        toast.success("Demoted to paper");
        onSuccess();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleCloseAllAndDemote() {
    startTransition(async () => {
      const result = await closeAllLivePositionsAndDemote(preview.analystId);
      if (result.ok) {
        toast.success(`Closed ${result.closed} live position${result.closed === 1 ? "" : "s"} and demoted to paper.`);
        onSuccess();
      } else {
        toast.error(result.error);
      }
    });
  }

  const hasOpenLive = preview.openLivePositions.length > 0;

  return (
    <Dialog open={true} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Demote {preview.analystName} to Paper</DialogTitle>
          <DialogDescription>
            This analyst will stop placing real-money trades. New entries will
            land in the paper account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Open live positions</Label>
            {!hasOpenLive ? (
              <p className="text-xs text-muted-foreground">
                None — demotion is safe to proceed.
              </p>
            ) : (
              <div className="rounded-md border divide-y text-xs">
                {preview.openLivePositions.map((p) => (
                  <div key={p.id} className="flex justify-between px-3 py-1.5">
                    <span className="tabular-nums">{p.symbol}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {p.direction} {p.quantity} @ ${p.avgCost.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {hasOpenLive && (
              <p className="text-xs text-muted-foreground">
                These must be closed in the live account before demoting. You
                can close them at market here, or close them manually first.
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {hasOpenLive ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleCloseAllAndDemote}
              disabled={submitting}
              className="gap-2"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Close all & demote
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSimpleDemote}
              disabled={submitting}
              className="gap-2"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Demote to Paper
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
