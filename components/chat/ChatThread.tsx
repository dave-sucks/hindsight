"use client";

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ChatThread({
  children,
  className,
  autoScroll = true,
}: {
  children: ReactNode;
  className?: string;
  /** Auto-scroll to bottom when children change (default true) */
  autoScroll?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const isNearBottomRef = useRef(true);

  // Track if user has scrolled away from bottom
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distFromBottom < 120;
    setShowScrollBtn(distFromBottom > 200);
  }, []);

  // Auto-scroll when children change (new messages)
  useEffect(() => {
    if (!autoScroll || !isNearBottomRef.current) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  });

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  return (
    <div className={cn("relative flex-1 overflow-hidden", className)}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto"
      >
        <div className="mx-auto max-w-2xl px-4 sm:px-6 py-6 space-y-5">
          {children}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Scroll-to-bottom button */}
      {showScrollBtn && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-full shadow-md bg-background"
            onClick={scrollToBottom}
            aria-label="Scroll to bottom"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}
