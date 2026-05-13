"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setCurrentEnvironment } from "@/lib/actions/environment.actions";
import { ChevronDown, Beaker, Rocket } from "lucide-react";
import type { AlpacaEnvironment } from "@/lib/actions/api-keys.actions";

/**
 * Global env switcher — Stripe-style. Lives in the top header. Sets a
 * cookie that every server component reads via getCurrentEnvironment().
 * Hidden until the user has any live key / position / analyst, so a
 * paper-only user sees no chrome they can't use.
 */
export function EnvironmentSwitcher({
  current,
}: {
  current: AlpacaEnvironment;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isLive = current === "LIVE";

  function select(env: AlpacaEnvironment) {
    if (env === current) return;
    startTransition(async () => {
      await setCurrentEnvironment(env);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            disabled={pending}
            className={
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs " +
              (isLive
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : "border-border bg-muted/30 text-muted-foreground")
            }
          >
            {isLive ? <Rocket className="h-3 w-3" /> : <Beaker className="h-3 w-3" />}
            <span className="font-medium">{isLive ? "Live" : "Paper"}</span>
            <ChevronDown className="h-3 w-3" />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => select("PAPER")}>
          <Beaker className="h-3.5 w-3.5" />
          <span className="flex-1">Paper</span>
          {current === "PAPER" && <span className="text-xs text-muted-foreground">current</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => select("LIVE")}>
          <Rocket className="h-3.5 w-3.5" />
          <span className="flex-1">Live</span>
          {current === "LIVE" && <span className="text-xs text-muted-foreground">current</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
