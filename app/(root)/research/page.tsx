import { Card, CardContent } from "@/components/ui/card";
import { FlaskConical } from "lucide-react";

export default function ResearchPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-foreground mb-6">Research</h1>
      <Card className="border-border">
        <CardContent className="flex flex-col items-center justify-center py-20 gap-4">
          <FlaskConical className="h-12 w-12 text-muted-foreground/40" />
          <div className="text-center">
            <p className="text-lg font-medium text-foreground">No research yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              The AI agent will generate trade theses here once connected.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
