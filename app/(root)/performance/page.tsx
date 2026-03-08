import { Card, CardContent } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

export default function PerformancePage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-foreground mb-6">Performance</h1>
      <Card className="border-border">
        <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
          <BarChart3 className="h-12 w-12 text-muted-foreground/40" />
          <div className="text-center">
            <p className="text-lg font-medium text-foreground">No performance data yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Portfolio analytics and equity curves will appear once trades are placed.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
