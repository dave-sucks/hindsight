"use client";

/**
 * Principal Chat — operator co-pilot.
 *
 * Thin wrapper over AgentChat (the unified chat component). Owns the
 * scope state (which analyst the chat is bound to). Persists choice in
 * localStorage so reloads remember.
 *
 * Scope chip lives in AgentChat's topSlot — same banner pattern Notion
 * and Linear use. NO URL param — scope is set in the input UI.
 */

import { useCallback, useState } from "react";
import { AgentChat } from "@/components/agent/AgentChat";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Bot, ChevronDown, Wallet } from "lucide-react";

const SCOPE_PREF_KEY = "hindsight_principal_scope";

function getStoredScope(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(SCOPE_PREF_KEY);
}

function storeScope(value: string | null) {
  if (typeof window === "undefined") return;
  if (value) localStorage.setItem(SCOPE_PREF_KEY, value);
  else localStorage.removeItem(SCOPE_PREF_KEY);
}

interface Props {
  analysts: Array<{ id: string; name: string; enabled: boolean }>;
}

export function ChatPageClient({ analysts }: Props) {
  // Hydrate scope from localStorage on first render. If the stored id
  // no longer matches an analyst the user owns, drop back to portfolio.
  const [scopedAnalystId, setScopedAnalystId] = useState<string | null>(() => {
    const stored = getStoredScope();
    if (!stored) return null;
    return analysts.some((a) => a.id === stored) ? stored : null;
  });

  const scopedAnalyst = scopedAnalystId
    ? analysts.find((a) => a.id === scopedAnalystId) ?? null
    : null;

  const handlePickScope = useCallback((analystId: string | null) => {
    setScopedAnalystId(analystId);
    storeScope(analystId);
  }, []);

  const scopeChip = (
    <div className="flex items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm">
              {scopedAnalyst ? (
                <>
                  <Bot className="h-3.5 w-3.5" />
                  {scopedAnalyst.name}
                </>
              ) : (
                <>
                  <Wallet className="h-3.5 w-3.5" />
                  Portfolio
                </>
              )}
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem onClick={() => handlePickScope(null)}>
            <Wallet className="h-3.5 w-3.5" />
            Portfolio (no analyst pinned)
          </DropdownMenuItem>
          {analysts.length > 0 && <DropdownMenuSeparator />}
          {analysts.map((a) => (
            <DropdownMenuItem
              key={a.id}
              onClick={() => handlePickScope(a.id)}
            >
              <Bot className="h-3.5 w-3.5" />
              {a.name}
              {!a.enabled && (
                <span className="ml-auto text-xs text-muted-foreground">
                  disabled
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="text-xs text-muted-foreground">
        {scopedAnalyst
          ? "Trades, thesis edits, watchlist changes apply to this analyst."
          : "Read-only across analysts. Pick one to unlock writes."}
      </span>
    </div>
  );

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col">
      <AgentChat
        mode="principal"
        analystId={scopedAnalystId ?? undefined}
        analystName={scopedAnalyst?.name}
        topSlot={scopeChip}
      />
    </div>
  );
}
