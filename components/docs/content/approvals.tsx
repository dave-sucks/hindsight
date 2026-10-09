"use client";

import { Bell, Clock, Mail } from "lucide-react";
import { StockLogo } from "@/components/StockLogo";
import { Anatomy, Code, DocBody, DocHeader, Section, Stage, TechDetails, Trio } from "../primitives";

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

export function ApprovalsDoc() {
  return (
    <DocBody>
      <DocHeader
        lead="Analysts propose. You approve."
        rest="Every buy, sale, add and trim an analyst wants waits in your queue with its reason. Nothing fills until you say yes."
      />

      <Stage label="Example">
        <div className="grid items-center gap-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <ProposalMock />
          <PushMock />
        </div>
      </Stage>

      <Trio
        items={[
          { title: "Everywhere at once", body: "The moment a run proposes a trade, it's in your queue, your inbox and on your phone." },
          { title: "A day to decide", body: "A proposal expires after 24 hours. A sale whose line is still crossed asks again the next day." },
          { title: "Your answer counts", body: "A decline is recorded and read by every run after. Asking again takes new reasons, said plainly." },
        ]}
      />

      <Section eyebrow="What a proposal carries" lead="Everything you need to say yes or no.">
        <Anatomy
          items={[
            { title: "The trade", body: "The stock, buy or sell, the shares and the price it expects." },
            { title: "The reason", body: "In the analyst's words: the call, the stock, the price, then why." },
            { title: "What caused it", body: "The trigger that fired, or the run that decided it." },
            { title: "The clock", body: "When it expires if you don't answer." },
          ]}
        />
      </Section>

      <Section eyebrow="Live and paper" lead="Real money always asks." rest="On a live account every buy and sale needs your approval by default. A paper account can let its analysts trade on their own; that's a setting you choose.">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { t: "Live account", b: "Buys and sales need your approval. Recommended, and on unless you change it." },
            { t: "Paper account", b: "Off by default, so analysts can practise freely. Turn it on to review every paper trade too." },
          ].map((c) => (
            <div key={c.t} className="flex flex-col gap-1.5 rounded-xl border bg-card p-4">
              <p className="text-sm font-medium text-foreground">{c.t}</p>
              <p className="text-sm text-muted-foreground">{c.b}</p>
            </div>
          ))}
        </div>
      </Section>

      <TechDetails
        rows={[
          { label: "The gate", value: <><Code>maybeAwaitApproval</Code> in <Code>lib/proposals/maybe-await-approval.ts</Code>, called by every trade path before anything reaches Alpaca.</> },
          { label: "Stored as", value: <><Code>Order</Code> with status <Code>AWAITING_APPROVAL</Code> and an <Code>expiresAt</Code> 24 hours out; <Code>proposal-expiry.ts</Code> closes the stale ones.</> },
          { label: "Alerts", value: <>An email (<Code>lib/emails/proposal-pending</Code>) and a phone push through ntfy (<Code>lib/notify/proposal-push.ts</Code>).</> },
          { label: "Settings", value: <><Code>requireApprovalBuysLive</Code> and <Code>requireApprovalSellsLive</Code> default on; the paper pair defaults off.</> },
          { label: "Agents", value: <>Approve and reject are never an agent&apos;s tools. A run can read the queue (<Code>list_proposals</Code>) but only you can answer it.</> },
        ]}
      />
    </DocBody>
  );
}
