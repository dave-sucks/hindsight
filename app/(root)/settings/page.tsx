import { createClient } from "@/lib/supabase/server";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getApiKeyStatus } from "@/lib/actions/api-keys.actions";
import { AlpacaKeyForm } from "@/components/settings/AlpacaKeyForm";
import { ModelPreferenceForm } from "@/components/settings/ModelPreferenceForm";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const alpacaStatus = await getApiKeyStatus("ALPACA");
  const elevenLabsConfigured = !!process.env.ELEVENLABS_API_KEY;
  const displayName = user?.user_metadata?.full_name ?? user?.email ?? "—";

  return (
    <div className="px-4 sm:px-6 py-6 max-w-2xl mx-auto space-y-6">
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
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="text-sm">{displayName}</span>
            </div>
            <Separator />
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm">{user?.email ?? "—"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Team */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Team
        </p>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Manage members and invites</p>
              <p className="text-xs text-muted-foreground">
                Invite teammates as Editors or Viewers.
              </p>
            </div>
            <Link href="/settings/team">
              <Button variant="outline">Open</Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Agent */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Agent
        </p>
        <ModelPreferenceForm />
      </div>

      {/* API Keys */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          API Keys
        </p>
        <AlpacaKeyForm initial={alpacaStatus} />
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs font-bold">
                  11
                </div>
                <div>
                  <p className="text-sm font-medium">ElevenLabs TTS</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    ELEVENLABS_API_KEY
                  </p>
                </div>
              </div>
              <Badge variant={elevenLabsConfigured ? "default" : "outline"}>
                {elevenLabsConfigured ? "Configured" : "Not set"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
