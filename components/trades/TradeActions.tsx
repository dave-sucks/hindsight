"use client";

/**
 * The one warning the header's menu needs: closing an open trade at the
 * market. The menu item lives in the header (components/domain/thesis-header.tsx);
 * this is the dialog it opens. "View run" and "Cancel order" went with the
 * legacy ··· menu (2026-11-04).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { closeTrade } from "@/lib/actions/closeTrade.actions";

export function CloseTradeDialog({
  tradeId,
  ticker,
  open,
  onOpenChange,
}: {
  tradeId: string;
  ticker: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function close() {
    setLoading(true);
    try {
      await closeTrade(tradeId, "MANUAL");
      toast.success("Trade closed");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Close trade — {ticker}</DialogTitle>
          <DialogDescription>
            This sells the whole position at the current market price. The realized P&L is recorded. It cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={loading}>
            Keep
          </Button>
          <Button variant="destructive" size="sm" onClick={close} disabled={loading} className="gap-2">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Closing…" : "Close trade"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
