"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import { ChevronDown, RefreshCw, Trash2, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import { ConnectionCard, ConnectionSubRow } from "./ConnectionCard";
import {
  saveApiKey,
  deleteApiKey,
  reverifyApiKey,
  type ApiKeyStatus,
  type AlpacaEnvironment,
} from "@/lib/actions/api-keys.actions";

const LOGO = (
  <Image
    src="/assets/icons/alpaca.svg"
    alt="Alpaca"
    width={32}
    height={32}
    className="rounded-md"
  />
);

const ENV_COPY: Record<AlpacaEnvironment, { label: string; placeholder: string; keysUrl: string }> = {
  PAPER: {
    label: "Paper",
    placeholder: "PK...",
    keysUrl: "https://app.alpaca.markets/paper/account/management",
  },
  LIVE: {
    label: "Live",
    placeholder: "AK...",
    keysUrl: "https://app.alpaca.markets/account/management",
  },
};

/**
 * AlpacaConnectionCard — one card, two sub-rows (Paper + Live).
 *
 * Each sub-row is a Collapsible that expands inline to reveal Update keys
 * / Re-verify / Remove actions and (when Update is active) the credential
 * input form. No dialog, no separate route — everything stays on the page.
 *
 * Non-OWNER members see read-only status; the editor sees the full action
 * panel. Read-only handling for the non-owner case is intentionally a
 * trailing message instead of a sub-row (renders inside the same card).
 */
export function AlpacaConnectionCard({
  paper,
  live,
  canEdit,
  ownerEmail,
}: {
  paper: ApiKeyStatus;
  live: ApiKeyStatus;
  canEdit: boolean;
  ownerEmail?: string | null;
}) {
  if (!canEdit) {
    return (
      <ConnectionCard
        logo={LOGO}
        title="Alpaca"
        description={`Trading credentials are managed by ${ownerEmail ?? "the account owner"}. Your runs trade against the team's Alpaca account.`}
        status={paper.hasKey ? "connected" : "not-connected"}
      />
    );
  }

  return (
    <ConnectionCard
      logo={LOGO}
      title="Alpaca"
      description="Paper and live trading."
    >
      <AlpacaSubRow environment="PAPER" initial={paper} />
      <AlpacaSubRow environment="LIVE" initial={live} />
    </ConnectionCard>
  );
}

function AlpacaSubRow({
  environment,
  initial,
}: {
  environment: AlpacaEnvironment;
  initial: ApiKeyStatus;
}) {
  const copy = ENV_COPY[environment];
  const [status, setStatus] = useState(initial);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <ConnectionSubRow
        label={copy.label}
        secondary={
          status.hasKey ? (
            <span className="tabular-nums">{status.keyHint}</span>
          ) : (
            "Not configured"
          )
        }
        status={
          status.hasKey
            ? status.verified
              ? "connected"
              : "configured"
            : "not-connected"
        }
        trailing={
          <CollapsibleTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Manage keys">
                <ChevronDown
                  className={
                    "transition-transform " + (open ? "rotate-180" : "")
                  }
                />
              </Button>
            }
          />
        }
      >
        <CollapsibleContent>
          <div className="px-4 pb-4">
            {editing || !status.hasKey ? (
              <KeyEditForm
                environment={environment}
                onCancel={status.hasKey ? () => setEditing(false) : undefined}
                onSaved={(next) => {
                  setStatus(next);
                  setEditing(false);
                }}
                keysUrl={copy.keysUrl}
              />
            ) : (
              <KeyActions
                environment={environment}
                status={status}
                onEdit={() => setEditing(true)}
                onStatusChange={setStatus}
              />
            )}
          </div>
        </CollapsibleContent>
      </ConnectionSubRow>
    </Collapsible>
  );
}

function KeyActions({
  environment,
  status,
  onEdit,
  onStatusChange,
}: {
  environment: AlpacaEnvironment;
  status: ApiKeyStatus;
  onEdit: () => void;
  onStatusChange: (next: ApiKeyStatus) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleReverify() {
    startTransition(async () => {
      const result = await reverifyApiKey("ALPACA", environment);
      if (result.verified) {
        toast.success("Connection verified");
        onStatusChange({ ...status, verified: true, verifiedAt: new Date().toISOString() });
      } else {
        toast.error(result.error || "Verification failed");
        onStatusChange({ ...status, verified: false });
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteApiKey("ALPACA", environment);
      if (result.success) {
        toast.success("Keys removed");
        onStatusChange({
          hasKey: false,
          provider: "ALPACA",
          environment,
          keyHint: null,
          verified: false,
          verifiedAt: null,
          label: null,
        });
      } else {
        toast.error(result.error || "Failed to remove");
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 pt-3">
      <Button variant="outline" size="sm" onClick={onEdit} disabled={pending}>
        Update keys
      </Button>
      <Button variant="outline" size="sm" onClick={handleReverify} disabled={pending}>
        <RefreshCw />
        Re-verify
      </Button>
      <Button variant="outline" size="sm" onClick={handleDelete} disabled={pending}>
        <Trash2 />
        Remove
      </Button>
      {status.verifiedAt && (
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          Last verified {new Date(status.verifiedAt).toLocaleDateString()}
        </span>
      )}
    </div>
  );
}

function KeyEditForm({
  environment,
  onCancel,
  onSaved,
  keysUrl,
}: {
  environment: AlpacaEnvironment;
  onCancel?: () => void;
  onSaved: (next: ApiKeyStatus) => void;
  keysUrl: string;
}) {
  const copy = ENV_COPY[environment];
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [pending, startTransition] = useTransition();

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
            ? "Keys saved and verified"
            : "Keys saved but verification failed — check credentials",
        );
        onSaved({
          hasKey: true,
          provider: "ALPACA",
          environment,
          keyHint: `...${apiKey.trim().slice(-4)}`,
          verified: result.verified,
          verifiedAt: result.verified ? new Date().toISOString() : null,
          label: null,
        });
        setApiKey("");
        setApiSecret("");
      } else {
        toast.error(result.error || "Failed to save");
      }
    });
  }

  return (
    <div className="pt-3 space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`alpaca-key-${environment}`} className="text-xs">
          API Key
        </Label>
        <Input
          id={`alpaca-key-${environment}`}
          type="text"
          placeholder={copy.placeholder}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`alpaca-secret-${environment}`} className="text-xs">
          API Secret
        </Label>
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
            aria-label={showSecret ? "Hide secret" : "Show secret"}
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Get your keys from{" "}
        <a
          href={keysUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Alpaca Account Management
        </a>
        .
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave} disabled={pending}>
          {pending ? "Saving…" : "Save & verify"}
        </Button>
        {onCancel && (
          <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
