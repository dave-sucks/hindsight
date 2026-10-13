"use client";

import { Bell, Clock, Mail } from "lucide-react";
import { StockLogo } from "@/components/StockLogo";
import { Stage } from "../primitives";

function ProposalMock() {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border bg-background p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <StockLogo ticker="SHOP" size="sm" />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">Sell 120 shares of SHOP</span>
          <span className="text-xs text-muted-foreground tabular-nums">at about $95.12 · PEAD Specialist</span>
        </div>
        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-500">
          <Clock className="size-3" />
          23 h left
        </span>
      </div>
      <p className="text-sm text-foreground">
        Selling Shopify at $95.12. It closed through the $96 floor under the gap-day low on 1.6× volume, with no company news. The drift has failed.
      </p>
      <p className="text-xs text-muted-foreground">From the trigger: Sell if below $96</p>
      <div className="flex gap-2" aria-hidden>
        <span className="inline-flex h-8 items-center rounded-lg bg-foreground px-3 text-sm font-medium text-background">Approve</span>
        <span className="inline-flex h-8 items-center rounded-lg border px-3 text-sm text-foreground">Decline</span>
      </div>
    </div>
  );
}

function PushMock() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-start gap-3 rounded-2xl border bg-background/80 p-3 shadow-sm backdrop-blur">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background">
          <Bell className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted-foreground">Hindsight · now</span>
          <span className="text-sm font-medium text-foreground">Sell SHOP? 120 shares at ~$95.12</span>
          <span className="truncate text-xs text-muted-foreground">PEAD Specialist · expires tomorrow 10:40 AM</span>
        </div>
      </div>
      <div className="flex items-start gap-3 rounded-2xl border bg-background/80 p-3 shadow-sm">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          <Mail className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-xs text-muted-foreground">Email</span>
          <span className="text-sm font-medium text-foreground">A sale is waiting for you: SHOP</span>
        </div>
      </div>
    </div>
  );
}

/** A proposal as it waits in the queue, and the alerts that go out with it. */
export function ProposalExample() {
  return (
    <Stage label="Example">
      <div className="grid items-center gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <ProposalMock />
        <PushMock />
      </div>
    </Stage>
  );
}
