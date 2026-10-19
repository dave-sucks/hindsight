"use client";

/**
 * Recent Chats sidebar for /chat.
 *
 * Left-side Sheet listing the user's past PRINCIPAL_CHAT runs by recency
 * (Today / Yesterday / Previous 7 days / …), the way every chat app does.
 * Each row is just the chat's first message; the time and the analyst it
 * was scoped to sit in a hover tooltip. Clicking a chat navigates to
 * /chat?resume=<runId> — the server component hydrates AgentChat with the
 * persisted thread so the user can continue from where they left off.
 */

import Link from "next/link";
import { History, MessageSquare } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { ChatHistoryItem } from "@/lib/actions/chat.actions";

// ── Trigger button (rendered in ChatPageClient header area) ──────────────

export function RecentChatsTrigger({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-2"
      onClick={onClick}
      aria-label="Open recent chats"
    >
      <History />
      Recent
    </Button>
  );
}

// ── Sidebar sheet ────────────────────────────────────────────────────────

export function RecentChatsSidebar({
  open,
  onOpenChange,
  chats,
  currentRunId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Most recent activity first. */
  chats: ChatHistoryItem[];
  /** If set, the row matching this runId is highlighted as "current". */
  currentRunId: string | null;
}) {
  const buckets = bucketByRecency(chats);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-sm p-0 flex flex-col">
        <SheetHeader className="border-b">
          <SheetTitle>Recent chats</SheetTitle>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2">
            {chats.length === 0 ? (
              <EmptyState />
            ) : (
              buckets.map((bucket) => (
                <div key={bucket.label} className="mb-3">
                  <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    {bucket.label}
                  </p>
                  <div className="flex flex-col">
                    {bucket.chats.map((chat) => (
                      <ChatRow
                        key={chat.runId}
                        chat={chat}
                        isCurrent={chat.runId === currentRunId}
                        onClick={() => onOpenChange(false)}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ── Single chat row ──────────────────────────────────────────────────────

function ChatRow({
  chat,
  isCurrent,
  onClick,
}: {
  chat: ChatHistoryItem;
  isCurrent: boolean;
  onClick: () => void;
}) {
  const detail = [chat.analystName, formatExactDate(chat.lastActivityAt)]
    .filter(Boolean)
    .join(" · ");

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={`/chat?resume=${encodeURIComponent(chat.runId)}`}
            onClick={onClick}
            aria-current={isCurrent ? "page" : undefined}
            className={cn(
              "block truncate rounded-md px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-muted",
              isCurrent && "bg-muted",
              !chat.preview && "text-muted-foreground",
            )}
          />
        }
      >
        {chat.preview ?? "New chat"}
      </TooltipTrigger>
      <TooltipContent side="right">{detail}</TooltipContent>
    </Tooltip>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <MessageSquare className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">No past chats</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Your conversations will show up here.
      </p>
    </div>
  );
}

// ── Recency buckets ──────────────────────────────────────────────────────

function bucketByRecency(
  chats: ChatHistoryItem[],
): Array<{ label: string; chats: ChatHistoryItem[] }> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 24 * 60 * 60 * 1000;

  const labelFor = (date: Date | string): string => {
    const d = typeof date === "string" ? new Date(date) : date;
    const t = d.getTime();
    if (t >= startOfToday) return "Today";
    if (t >= startOfToday - DAY) return "Yesterday";
    if (t >= startOfToday - 7 * DAY) return "Previous 7 days";
    if (t >= startOfToday - 30 * DAY) return "Previous 30 days";
    return d.toLocaleDateString("en-US", {
      month: "long",
      ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
    });
  };

  // Input is already newest-first, so buckets come out in order.
  const buckets: Array<{ label: string; chats: ChatHistoryItem[] }> = [];
  for (const chat of chats) {
    const label = labelFor(chat.lastActivityAt);
    const last = buckets[buckets.length - 1];
    if (last?.label === label) last.chats.push(chat);
    else buckets.push({ label, chats: [chat] });
  }
  return buckets;
}

function formatExactDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
