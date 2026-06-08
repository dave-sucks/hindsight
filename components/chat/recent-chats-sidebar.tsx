"use client";

/**
 * Recent Chats sidebar for /chat.
 *
 * Left-side Sheet listing the user's past PRINCIPAL_CHAT runs grouped by
 * analyst, most-recent activity first. Clicking a chat navigates to
 * /chat?resume=<runId> — the server component hydrates AgentChat with
 * the persisted thread so the user can continue from where they left off.
 *
 * Why a Sheet and not a Sidebar component:
 *   - Sheet is modal-light; closes when user clicks back into chat
 *   - No layout shift on the main chat surface
 *   - Mirrors the HowItWorksSheet pattern already in the codebase
 *
 * Why grouped by analyst (vs flat reverse-chronological):
 *   - Mirrors how the user thinks about chats — "the conversations I had
 *     with Tech Momentum Trader" vs "yesterday at 4pm"
 *   - Most users have ~6 analysts, so groups stay short and scannable
 */

import { useRouter } from "next/navigation";
import { History, MessageSquare } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ChatHistoryGroup, ChatHistoryItem } from "@/lib/actions/chat.actions";

// ── Trigger button (rendered in ChatPageClient header area) ──────────────
//
// Ghost icon-with-text button. Same top-left spot as before; the count
// pill was dropped — the open Sheet shows the same number more legibly.

export function RecentChatsTrigger({
  onClick,
}: {
  onClick: () => void;
  /** Deprecated — accepted for callsite compatibility; ignored. */
  count?: number;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
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
  groups,
  currentRunId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: ChatHistoryGroup[];
  /** If set, the row matching this runId is highlighted as "current". */
  currentRunId: string | null;
}) {
  const totalChats = groups.reduce((n, g) => n + g.chats.length, 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-sm p-0 flex flex-col">
        <SheetHeader className="border-b">
          <SheetTitle>Recent chats</SheetTitle>
          <SheetDescription>
            {totalChats === 0
              ? "No past chats yet. Pick an analyst from the scope dropdown to start one."
              : `${totalChats} past ${totalChats === 1 ? "chat" : "chats"} across ${groups.length} ${groups.length === 1 ? "analyst" : "analysts"}. Click any to resume.`}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-2">
            {groups.length === 0 ? (
              <EmptyState />
            ) : (
              groups.map((group) => (
                <AnalystGroup
                  key={group.analyst.id}
                  group={group}
                  currentRunId={currentRunId}
                  onChatClick={() => onOpenChange(false)}
                />
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ── Per-analyst group ────────────────────────────────────────────────────

function AnalystGroup({
  group,
  currentRunId,
  onChatClick,
}: {
  group: ChatHistoryGroup;
  currentRunId: string | null;
  onChatClick: () => void;
}) {
  return (
    <div className="mb-3">
      <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {group.analyst.name}
      </p>
      <div className="flex flex-col">
        {group.chats.map((chat) => (
          <ChatRow
            key={chat.runId}
            chat={chat}
            isCurrent={chat.runId === currentRunId}
            onClick={onChatClick}
          />
        ))}
      </div>
    </div>
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
  const router = useRouter();

  const handleClick = () => {
    onClick();
    router.push(`/chat?resume=${encodeURIComponent(chat.runId)}`);
  };

  // Title precedence: first user message (when we managed to extract one)
  // → "New chat" when the thread is empty → relative time when the row is
  // malformed/parse-failed. Time always renders below as the secondary line.
  const title = chat.preview ?? (chat.hasThread ? formatRelativeTime(chat.lastActivityAt) : "New chat");

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/50",
        isCurrent && "bg-muted/30",
      )}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <span className="flex-1 truncate text-sm text-foreground">{title}</span>
        {!chat.hasThread ? (
          <Badge variant="outline" className="shrink-0 text-xs">
            empty
          </Badge>
        ) : null}
        {isCurrent ? (
          <Badge variant="secondary" className="shrink-0 text-xs">
            current
          </Badge>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground">
        {formatRelativeTime(chat.lastActivityAt)} · started {formatExactDate(chat.startedAt)}
      </span>
    </button>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <MessageSquare className="h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">No past chats</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        Pick an analyst from the scope dropdown in the composer to start a
        new chat. Past chats with an analyst will show up here.
      </p>
    </div>
  );
}

// ── Date helpers ─────────────────────────────────────────────────────────

function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
