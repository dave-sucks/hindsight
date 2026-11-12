"use client";

/**
 * RunContext — what a run's latest model call was sent, read only from its
 * saved record (lib/agent/run-requests.ts), never rebuilt. The total, one
 * bar with a color per part (the Framework page's colors), a line per part
 * that opens its full text by section, and the raw request, copyable.
 *
 * Beside the conversation on a desktop, pushing it left so it still scrolls;
 * a Sheet on a phone. The ShadCN Sidebar is the app's fixed, full-height nav
 * (its own provider and shortcut) and Resizable isn't installed, so the
 * desktop panel is a plain column next to the chat.
 */

import { useEffect, useState } from "react";
import { ChevronRight, Copy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { JsonBlock } from "@/components/ai-elements/json-block";
import { SWATCH } from "@/components/docs/framework/swatch";
import { useIsMobile } from "@/hooks/use-mobile";
import type { CallView, SentCategory } from "@/lib/agent/run-requests";
import { getRunContext } from "@/lib/actions/run-context.actions";
import { cn } from "@/lib/utils";

const n = (x: number) => x.toLocaleString("en-US");
const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const color = (c: SentCategory) => (c.part ? SWATCH[c.part].className : "bg-muted-foreground/35");

export function RunContext({ runId, calls, open, onOpenChange }: { runId?: string; calls: CallView[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const isMobile = useIsMobile();
  // Read again each time it opens: a chat keeps one record per message.
  const [fresh, setFresh] = useState<CallView[] | null>(null);
  useEffect(() => {
    if (!open || !runId) return;
    let live = true;
    getRunContext(runId)
      .then((c) => live && setFresh(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [open, runId]);
  const list = fresh ?? calls;
  const call = list[list.length - 1] ?? null;
  const started = call?.call === "Chat message" || call?.call === "Follow-up" ? "What your latest message started with" : "What the run started with";
  const subtitle = !call
    ? ""
    : call.of
      ? `${started}: its first request to ${call.model}, as sent. It made ${call.of} in all; every tool call and result after this one is in the conversation.`
      : `What the run sent ${call.model}, as it was sent.`;
  if (isMobile)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Context</SheetTitle>
            <SheetDescription>{subtitle}</SheetDescription>
          </SheetHeader>
          <ContextBody call={call} />
        </SheetContent>
      </Sheet>
    );
  if (!open) return null;
  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l">
      <div className="flex items-start gap-2 px-4 pt-3">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-medium">Context</p>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close context" onClick={() => onOpenChange(false)}>
          <X />
        </Button>
      </div>
      <ContextBody call={call} />
    </aside>
  );
}

function ContextBody({ call }: { call: CallView | null }) {
  if (!call) return <p className="p-4 text-sm text-muted-foreground">This run kept no record of what it sent the model.</p>;

  async function copyRaw() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(call!.raw));
      toast.success("Request copied, exactly as sent");
    } catch {
      toast.error("Couldn't copy");
    }
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6 pt-3">
      <div className="space-y-2">
        <p className="text-sm tabular-nums">
          <span className="font-medium">{n(call.chars)} characters</span>
          <span className="text-muted-foreground"> · about {n(Math.round(call.chars / 4))} tokens</span>
        </p>
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          {call.categories.map((c, i) => (
            <div key={i} className={color(c)} style={{ width: `${share(c.chars, call.chars)}%` }} />
          ))}
        </div>
        {call.error && <p className="text-sm text-muted-foreground">The call failed: {call.error}</p>}
      </div>

      <div className="space-y-1">
        {call.categories.map((c, i) => (
          <Collapsible key={i}>
            <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
              <span className={cn("size-2 shrink-0 rounded-full", color(c))} />
              <span className="flex-1 font-medium">{c.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {n(c.chars)} · {share(c.chars, call.chars).toFixed(0)}%
              </span>
              <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Sections id={`part-${i}`} category={c} />
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>

      <Collapsible>
        <div className="flex items-center gap-2">
          <CollapsibleTrigger className="group flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
            <span className="flex-1 font-medium">Raw request</span>
            <span className="text-muted-foreground tabular-nums">{n(call.rawChars)} chars of JSON</span>
            <ChevronRight className="size-4 text-muted-foreground transition-transform group-data-[panel-open]:rotate-90" />
          </CollapsibleTrigger>
          <Button variant="ghost" size="icon-sm" aria-label="Copy the request exactly as sent" onClick={copyRaw}>
            <Copy />
          </Button>
        </div>
        <CollapsibleContent>
          <JsonBlock value={call.raw} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/** A part's full text, its sections listed first to jump to. */
function Sections({ id, category }: { id: string; category: SentCategory }) {
  const jump = (j: number) => document.getElementById(`${id}-${j}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div className="space-y-2 py-2 pl-6">
      {category.sections.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {category.sections.map((s, j) => (
            <Button key={j} variant="outline" size="xs" onClick={() => jump(j)}>
              {s.label}
            </Button>
          ))}
        </div>
      )}
      <div className="rounded-md border p-3 text-sm text-foreground">
        {category.sections.map((s, j) => (
          <div key={j} id={`${id}-${j}`} className="scroll-mt-2 whitespace-pre-wrap break-words">
            {s.text}
          </div>
        ))}
      </div>
    </div>
  );
}
