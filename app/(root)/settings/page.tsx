import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bot, ExternalLink } from "lucide-react";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Account and preferences
        </p>
      </div>
      <Separator />

      {/* Account */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Account
        </p>
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm tabular-nums">{user?.email ?? "—"}</span>
            </div>
            <Separator />
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">User ID</span>
              <span className="text-xs font-mono text-muted-foreground truncate max-w-[200px]">
                {user?.id ?? "—"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Analysts → moved */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Analysts
        </p>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Manage Analysts</p>
                <p className="text-xs text-muted-foreground">
                  Create, configure, and review your AI analysts
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              render={<Link href="/analysts" />}
              className="shrink-0"
            >
              Open
              <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
