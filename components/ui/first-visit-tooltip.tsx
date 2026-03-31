"use client";

import { useState, useEffect, type ReactNode } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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

  if (!show) return <>{children}</>;

  return (
    <Popover open onOpenChange={(open) => { if (!open) dismiss(); }}>
      <PopoverTrigger render={<div className="w-full" />}>
        {children}
      </PopoverTrigger>
      <PopoverContent side={side}>
        <p className="text-sm text-muted-foreground">{content}</p>
      </PopoverContent>
    </Popover>
  );
}
