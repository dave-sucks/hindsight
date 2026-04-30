"use client";

/**
 * ElevenLabsKeyForm — settings form for ElevenLabs TTS API key.
 *
 * Mirror of AlpacaKeyForm. ElevenLabs uses a single API key (no secret).
 * Key is saved encrypted via the shared UserApiKey table (provider "ELEVENLABS").
 *
 * Tagged PODCAST-NEW in docs/PODCAST_FILES.md (Session 2).
 */

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  saveElevenLabsKey,
  deleteElevenLabsKey,
  type ApiKeyStatus,
} from "@/lib/actions/api-keys.actions";
import { Trash2, CheckCircle2, XCircle, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

export function ElevenLabsKeyForm({ initial }: { initial: ApiKeyStatus }) {
  const [status, setStatus] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    if (!apiKey.trim()) {
      toast.error("API key is required");
      return;
    }
    startTransition(async () => {
      const result = await saveElevenLabsKey(apiKey.trim());
      if (result.success) {
        toast.success(
          result.verified
            ? "ElevenLabs key saved and verified"
            : "Key saved but verification failed — check your credentials",
        );
        setStatus({
          hasKey: true,
          provider: "ELEVENLABS",
          keyHint: `...${apiKey.trim().slice(-4)}`,
          verified: result.verified,
          verifiedAt: result.verified ? new Date().toISOString() : null,
          paperMode: false,
          label: null,
        });
        setEditing(false);
        setApiKey("");
      } else {
        toast.error(result.error || "Failed to save");
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteElevenLabsKey();
      if (result.success) {
        toast.success("ElevenLabs key removed");
        setStatus({
          hasKey: false,
          provider: "ELEVENLABS",
          keyHint: null,
          verified: false,
          verifiedAt: null,
          paperMode: false,
          label: null,
        });
        setEditing(false);
      } else {
        toast.error(result.error || "Failed to delete");
      }
    });
  }

  if (!status.hasKey || editing) {
    return (
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs font-bold">
              11
            </div>
            <div>
              <p className="text-sm font-medium">ElevenLabs TTS</p>
              <p className="text-xs text-muted-foreground">
                Required for podcast audio generation
              </p>
            </div>
          </div>
          <Separator />
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="el-key" className="text-xs">
                API Key
              </Label>
              <div className="relative">
                <Input
                  id="el-key"
                  type={showKey ? "text" : "password"}
                  placeholder="sk_..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Get your key from{" "}
              <span className="font-mono text-foreground/70">
                elevenlabs.io → Profile → API key
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={isPending}>
              {isPending ? "Saving..." : "Save & Verify"}
            </Button>
            {editing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setApiKey("");
                }}
                disabled={isPending}
              >
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-xs font-bold">
              11
            </div>
            <div>
              <p className="text-sm font-medium">ElevenLabs TTS</p>
              <p className="text-xs text-muted-foreground">
                API Key: <span className="font-mono">{status.keyHint}</span>
              </p>
            </div>
          </div>
          <Badge variant={status.verified ? "default" : "destructive"}>
            {status.verified ? (
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Connected
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <XCircle className="h-3 w-3" /> Not Verified
              </span>
            )}
          </Badge>
        </div>
        {status.verifiedAt && (
          <p className="text-xs text-muted-foreground">
            Last verified: {new Date(status.verifiedAt).toLocaleDateString()}
          </p>
        )}
        <Separator />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
            disabled={isPending}
          >
            Update Key
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleDelete}
            disabled={isPending}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
