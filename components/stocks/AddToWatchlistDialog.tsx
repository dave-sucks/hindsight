"use client";

/**
 * The two questions a manual add asks (DAV-225).
 *
 * Research it now, and review it on a schedule, are independent decisions.
 * Every combination is legal; no to both is a name that sits on the list
 * costing nothing until you pick it up.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
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
  reviewClockDays: number | null;
}

const CADENCES = [
  ["1", "Every day"],
  ["7", "Every week"],
  ["30", "Every month"],
];

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
  const [research, setResearch] = React.useState(false);
  const [onClock, setOnClock] = React.useState(false);
  const [cadence, setCadence] = React.useState("7");

  // Fresh questions per name — the last answer is not the next default.
  React.useEffect(() => {
    if (open) {
      setResearch(false);
      setOnClock(false);
      setCadence("7");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Add {symbol} to {analystName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <Checkbox
            id="research-now"
            checked={research}
            onCheckedChange={(v) => setResearch(v === true)}
          />
          <Label htmlFor="research-now">Write a full thesis now</Label>
        </div>

        <div className="flex items-center gap-3">
          <Checkbox
            id="on-clock"
            checked={onClock}
            onCheckedChange={(v) => setOnClock(v === true)}
          />
          <Label htmlFor="on-clock">Review on a schedule</Label>
          {onClock ? (
            <Select value={cadence} onValueChange={(v) => setCadence(v ?? "7")}>
              <SelectTrigger size="sm" aria-label="Review schedule">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CADENCES.map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onConfirm({
                writeThesisNow: research,
                reviewClockDays: onClock ? Number(cadence) : null,
              });
              onOpenChange(false);
            }}
          >
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
