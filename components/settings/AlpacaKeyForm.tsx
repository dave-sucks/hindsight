"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  saveApiKey,
  deleteApiKey,
  reverifyApiKey,
  type ApiKeyStatus,
  type AlpacaEnvironment,
} from "@/lib/actions/api-keys.actions";
import { Trash2, RefreshCw, CheckCircle2, XCircle, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

const COPY: Record<AlpacaEnvironment, { title: string; subtitle: string; keysUrl: string; danger: boolean }> = {
  PAPER: {
    title: "Alpaca Paper Trading",
    subtitle: "Simulated trades against Alpaca's paper account",
    keysUrl: "https://app.alpaca.markets/paper/account/management",
    danger: false,
  },
  LIVE: {
    title: "Alpaca Live Trading",
    subtitle: "Real-money trades. Only used by analysts you've promoted to live.",
    keysUrl: "https://app.alpaca.markets/account/management",
    danger: true,
  },
};

export function AlpacaKeyForm({
  initial,
  environment,
}: {
  initial: ApiKeyStatus;
  environment: AlpacaEnvironment;
}) {
  const copy = COPY[environment];
  const [status, setStatus] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    if (!apiKey.trim() || !apiSecret.trim()) {
      toast.error("Both API Key and Secret are required");
      return;
    }
    startTransition(async () => {
      const result = await saveApiKey({
        provider: "ALPACA",
        environment,
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
      });
      if (result.success) {
        toast.success(
          result.verified
            ? `${copy.title} keys saved and verified`
            : "Keys saved but verification failed — check your credentials"
        );
        setStatus({
          hasKey: true,
          provider: "ALPACA",
          environment,
          keyHint: `...${apiKey.trim().slice(-4)}`,
          verified: result.verified,
          verifiedAt: result.verified ? new Date().toISOString() : null,
          label: null,
        });
        setEditing(false);
        setApiKey("");
        setApiSecret("");
      } else {
        toast.error(result.error || "Failed to save");
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteApiKey("ALPACA", environment);
      if (result.success) {
        toast.success(`${copy.title} keys removed`);
        setStatus({
          hasKey: false,
          provider: "ALPACA",
          environment,
          keyHint: null,
          verified: false,
          verifiedAt: null,
          label: null,
        });
        setEditing(false);
      } else {
        toast.error(result.error || "Failed to delete");
      }
    });
  }

  function handleReverify() {
    startTransition(async () => {
      const result = await reverifyApiKey("ALPACA", environment);
      if (result.verified) {
        toast.success(`${copy.title} connection verified`);
        setStatus((s) => ({ ...s, verified: true, verifiedAt: new Date().toISOString() }));
      } else {
        toast.error(result.error || "Verification failed");
        setStatus((s) => ({ ...s, verified: false }));
      }
    });
  }

  // ─── No key saved yet, or editing ──────────────────────────────────────────

  if (!status.hasKey || editing) {
    return (
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img src="/assets/icons/alpaca.svg" alt="Alpaca" className="h-8 w-8 rounded" />
              <div>
                <p className="text-sm font-medium">{copy.title}</p>
                <p className="text-xs text-muted-foreground">{copy.subtitle}</p>
              </div>
            </div>
            <Badge variant={copy.danger ? "destructive" : "outline"}>{environment}</Badge>
          </div>
          <Separator />
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`alpaca-key-${environment}`} className="text-xs">API Key</Label>
              <Input
                id={`alpaca-key-${environment}`}
                type="text"
                placeholder={environment === "LIVE" ? "AK..." : "PK..."}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`alpaca-secret-${environment}`} className="text-xs">API Secret</Label>
              <div className="relative">
                <Input
                  id={`alpaca-secret-${environment}`}
                  type={showSecret ? "text" : "password"}
                  placeholder="Secret key"
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Get your keys from{" "}
              <a
                href={copy.keysUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Alpaca Account Management
              </a>
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
                  setApiSecret("");
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

  // ─── Key exists — show status ──────────────────────────────────────────────

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/assets/icons/alpaca.svg" alt="Alpaca" className="h-8 w-8 rounded" />
            <div>
              <p className="text-sm font-medium">{copy.title}</p>
              <p className="text-xs text-muted-foreground">
                API Key: <span className="font-mono">{status.keyHint}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={copy.danger ? "destructive" : "outline"}>{environment}</Badge>
            <Badge variant={status.verified ? "default" : "destructive"}>
              {status.verified ? (
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Connected</span>
              ) : (
                <span className="flex items-center gap-1"><XCircle className="h-3 w-3" /> Not Verified</span>
              )}
            </Badge>
          </div>
        </div>
        {status.verifiedAt && (
          <p className="text-xs text-muted-foreground">
            Last verified: {new Date(status.verifiedAt).toLocaleDateString()}
          </p>
        )}
        <Separator />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={isPending}>
            Update Keys
          </Button>
          <Button variant="outline" size="sm" onClick={handleReverify} disabled={isPending}>
            <RefreshCw className="h-3 w-3 mr-1" />
            {isPending ? "Checking..." : "Re-verify"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleDelete} disabled={isPending}>
            <Trash2 className="h-3 w-3 mr-1" />
            Remove
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
