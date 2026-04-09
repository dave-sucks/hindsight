"use client";

/**
 * ThesisCardRenderer — renders the ThesisArtifactSheet for record_thesis results.
 *
 * In Step 2 this shows a summary. Full sheet extraction happens in Step 6.
 */

import type { ToolResult } from "@/lib/agent/tool-result";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface Props {
  toolName: string;
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function ThesisCardRenderer({ result, loading }: Props) {
  const data = result.data as Record<string, unknown> | null;
  const ticker = (data?.ticker as string) ?? "";
  const direction = (data?.direction as string) ?? "";
  const confidence = (data?.confidence as number) ?? (data?.confidenceScore as number) ?? null;

  if (loading) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground">
          Recording thesis{ticker ? ` for ${ticker}` : ""}...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        {direction && (
          <Badge variant={direction === "LONG" ? "default" : direction === "SHORT" ? "destructive" : "secondary"}>
            {direction}
          </Badge>
        )}
        {ticker && <span className="text-sm font-semibold">{ticker}</span>}
        {confidence != null && (
          <span className="text-xs text-muted-foreground">{confidence}% confidence</span>
        )}
        <span className="text-sm text-muted-foreground ml-auto line-clamp-1">{result.summary}</span>
      </CardContent>
    </Card>
  );
}
