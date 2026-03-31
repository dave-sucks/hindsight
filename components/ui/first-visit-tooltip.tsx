"use client";

import { useState, useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FirstVisitTooltipProps {
  content: string;
  storageKey: string;
  side?: "top" | "bottom";
  children: ReactNode;
}

export function FirstVisitTooltip({
  content,
  storageKey,
  side = "top",
  children,
}: FirstVisitTooltipProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const key = `hindsight-fvt-${storageKey}`;
    if (!localStorage.getItem(key)) {
      setShow(true);
    }
  }, [storageKey]);

  function dismiss() {
    localStorage.setItem(`hindsight-fvt-${storageKey}`, "1");
    setShow(false);
  }

  // Render children normally — tooltip is absolutely positioned alongside them,
  // NOT wrapping them inside a trigger (which breaks nested interactive elements).
  return (
    <div className="relative">
      {children}

      {show && (
        <>
          {/* Dismiss on any click outside the tooltip */}
          <div
            className="fixed inset-0 z-40"
            onClick={dismiss}
            aria-hidden="true"
          />
          <div
            role="tooltip"
            className={cn(
              "absolute left-1/2 -translate-x-1/2 z-50",
              "w-max max-w-xs px-3 py-2",
              "rounded-md border bg-popover shadow-md",
              "text-sm text-popover-foreground",
              "animate-in fade-in-0 zoom-in-95 duration-200",
              side === "top"
                ? "bottom-[calc(100%+10px)]"
                : "top-[calc(100%+10px)]",
            )}
          >
            {content}
            <span
              className={cn(
                "absolute left-1/2 -translate-x-1/2 h-2 w-2 rotate-45 border bg-popover",
                side === "top"
                  ? "bottom-[-5px] border-t-0 border-l-0"
                  : "top-[-5px] border-b-0 border-r-0",
              )}
            />
          </div>
        </>
      )}
    </div>
  );
}
