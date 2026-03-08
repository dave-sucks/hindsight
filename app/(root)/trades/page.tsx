import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeftRight } from "lucide-react";

export default function TradesPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-foreground mb-6">Trades</h1>
      <Card className="border-border">
        <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
          <ArrowLeftRight className="h-12 w-12 text-muted-foreground/40" />
          <div className="text-center">
            <p className="text-lg font-medium text-foreground">No trades yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Paper trades placed by the AI agent will appear here.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
