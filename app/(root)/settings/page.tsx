import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold text-foreground mb-6">Settings</h1>
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <Settings className="h-5 w-5 text-muted-foreground" />
            General Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
          <p className="text-sm text-muted-foreground">
            Settings configuration coming soon.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
