"use client";

/**
 * DecisionSummaryRenderer — for complete_run and record_decision_plan.
 * Full DecisionSummaryCard wiring happens in Step 5.
 */

import type { ToolResult } from "@/lib/agent/tool-result";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  result: Extract<ToolResult, { ok: true }>;
  loading: boolean;
}

export function DecisionSummaryRenderer({ result, loading }: Props) {
  if (loading) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground">
          Wrapping up run...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Run Complete</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground">{result.summary}</p>
      </CardContent>
    </Card>
  );
}
