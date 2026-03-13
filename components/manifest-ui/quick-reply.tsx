"use client";

import { cn } from "@/lib/utils";

/**
 * Represents a quick reply option.
 */
export interface QuickReply {
  label?: string;
  icon?: React.ReactNode;
}

export interface QuickReplyProps {
  data?: {
    /** Array of quick reply options to display as buttons. */
    replies?: QuickReply[];
  };
  actions?: {
    /** Called when a user selects a quick reply option. */
    onSelectReply?: (reply: QuickReply) => void;
  };
}

/**
 * Quick reply button set for chat interfaces.
 * Displays predefined response options as pill-shaped buttons.
 */
export function QuickReply({ data, actions }: QuickReplyProps) {
  const replies = data?.replies ?? [];
  const onSelectReply = actions?.onSelectReply;

  return (
    <div className="w-full rounded-lg bg-card p-4">
      <div className="flex flex-wrap gap-2">
        {replies.map((reply, index) => (
          <button
            key={index}
            onClick={() => onSelectReply?.(reply)}
            className={cn(
              "inline-flex cursor-pointer items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs text-foreground transition-colors sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-sm",
              "hover:border-foreground hover:bg-foreground hover:text-background"
            )}
          >
            {reply.icon}
            {reply.label && <span>{reply.label}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
