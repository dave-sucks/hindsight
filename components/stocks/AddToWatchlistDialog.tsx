"use client";

/**
 * AddToWatchlistDialog — the two questions a manual add asks (DAV-225).
 *
 * Adding a name to an analyst's list used to buy a weekly review whether you
 * wanted one or not. There are really two independent decisions here, and
 * every combination is legal:
 *
 *   1. Write a full thesis now?  → sends the ticker to the thesis writer,
 *      which does the deep research and mints the coverage itself.
 *   2. Review on a schedule?     → puts a review clock on the name.
 *
 * Neither is the default. "No" to both is a pinned name: it sits on the list
 * costing nothing until a person picks it up, which is a real thing to want.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface AddToWatchlistChoices {
  writeThesisNow: boolean;
  reviewCadenceDays: number | null;
}

const CADENCES = [
  { value: "1", label: "Every day" },
  { value: "7", label: "Every week" },
  { value: "30", label: "Every month" },
] as const;

export function AddToWatchlistDialog({
  open,
  onOpenChange,
  symbol,
  analystName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  symbol: string;
  analystName: string;
  onConfirm: (choices: AddToWatchlistChoices) => void;
}) {
  const [writeThesisNow, setWriteThesisNow] = React.useState(false);
  const [onClock, setOnClock] = React.useState(false);
  const [cadence, setCadence] = React.useState<string>("7");

  // Fresh questions each time the dialog opens — the last answer is not a
  // default for the next name.
  React.useEffect(() => {
    if (open) {
      setWriteThesisNow(false);
      setOnClock(false);
      setCadence("7");
    }
  }, [open]);

  const days = onClock ? Number(cadence) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Add {symbol} to {analystName}
          </DialogTitle>
          <DialogDescription>
            Two separate questions. Any answer is fine, including no to both.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="write-thesis-now"
              checked={writeThesisNow}
              onCheckedChange={(v) => setWriteThesisNow(v === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="write-thesis-now">Write a full thesis now</Label>
              <p className="text-xs text-muted-foreground">
                Sends {symbol} to the thesis writer for deep research. Takes a
                few minutes and costs a research run.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="review-on-schedule"
              checked={onClock}
              onCheckedChange={(v) => setOnClock(v === true)}
            />
            <div className="space-y-1">
              <Label htmlFor="review-on-schedule">Review on a schedule</Label>
              <p className="text-xs text-muted-foreground">
                {onClock
                  ? "The daily run picks this name up on that schedule."
                  : "Without a schedule the name costs nothing. Nothing looks at it until one of its triggers fires."}
              </p>
              {onClock ? (
                <Select
                  value={cadence}
                  onValueChange={(v) => setCadence(v ?? "7")}
                >
                  <SelectTrigger size="sm" aria-label="Review schedule">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CADENCES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onConfirm({ writeThesisNow, reviewCadenceDays: days });
              onOpenChange(false);
            }}
          >
            Add {symbol}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
