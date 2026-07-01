"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronsUpDown } from "lucide-react";
import { setCurrentEnvironment } from "@/lib/actions/environment.actions";
import { cn } from "@/lib/utils";
import type { AlpacaEnvironment } from "@/lib/actions/api-keys.actions";

/**
 * Global env switcher — lives in the sidebar header next to the logo icon.
 * Ghost-style button that fills remaining header width: colored dot + env
 * name + chevron (chevron only visible on hover).
 *
 * Paper: muted gray dot, static. Live: blue pulsing dot (matches the
 * "Holding" trade status dot).
 */
export function EnvironmentSwitcher({
  current,
  className,
}: {
  current: AlpacaEnvironment;
  className?: string;
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
            disabled={pending}
            className={cn(
              "group/env-trigger flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm",
              "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              "transition-colors disabled:opacity-50 outline-none",
              className,
            )}
          />
        }
      >
        <EnvDot env={current} />
        <span className="flex-1 truncate text-left">{isLive ? "Live" : "Paper"}</span>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover/env-trigger:opacity-100 transition-opacity" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-40">
        <DropdownMenuItem onClick={() => select("PAPER")}>
          <EnvDot env="PAPER" />
          <span className="flex-1">Paper</span>
          {current === "PAPER" && (
            <span className="text-xs text-muted-foreground">current</span>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => select("LIVE")}>
          <EnvDot env="LIVE" />
          <span className="flex-1">Live</span>
          {current === "LIVE" && (
            <span className="text-xs text-muted-foreground">current</span>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EnvDot({ env }: { env: AlpacaEnvironment }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full shrink-0",
        env === "LIVE"
          ? "bg-blue-500 animate-pulse"
          : "bg-muted-foreground/50",
      )}
      aria-hidden
    />
  );
}
