"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ThesisCard, type ThesisCardData } from "@/components/domain";
import { FileText } from "lucide-react";

/**
 * ThesisArtifactSheet — opens a full thesis as an "artifact" in a right-side sheet.
 * Click "View full analysis" → slides in a detailed, beautiful thesis view.
 */
export function ThesisArtifactSheet({
  thesis,
  children,
}: {
  thesis: ThesisCardData;
  children?: React.ReactNode;
}) {
  const isLong = thesis.direction === "LONG";
  const isShort = thesis.direction === "SHORT";

  return (
    <Sheet>
      <SheetTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              "border bg-background hover:bg-muted text-muted-foreground hover:text-foreground",
            )}
          />
        }
      >
        <FileText className="h-3.5 w-3.5" />
        {children ?? "View full analysis"}
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto"
      >
        <SheetHeader className="border-b pb-4">
          <div className="flex items-center gap-3">
            <SheetTitle className="font-mono text-xl font-bold">
              {thesis.ticker}
            </SheetTitle>
            <Badge
              variant="secondary"
              className={cn(
                "text-xs font-semibold",
                isLong && "bg-emerald-500/10 text-emerald-500",
                isShort && "bg-red-500/10 text-red-500",
              )}
            >
              {thesis.direction}
            </Badge>
            <span
              className={cn(
                "ml-auto flex items-center justify-center rounded-full size-10 text-sm font-bold tabular-nums",
                thesis.confidence_score >= 80
                  ? "bg-emerald-500/15 text-emerald-500"
                  : thesis.confidence_score >= 60
                    ? "bg-amber-500/15 text-amber-500"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {thesis.confidence_score}
            </span>
          </div>
        </SheetHeader>

        <div className="p-4">
          <ThesisCard {...thesis} className="border-0 shadow-none" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
