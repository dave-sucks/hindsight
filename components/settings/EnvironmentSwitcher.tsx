"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { ChevronsUpDown } from "lucide-react";
import { setCurrentEnvironment } from "@/lib/actions/environment.actions";
import { cn } from "@/lib/utils";
import type { AlpacaEnvironment } from "@/lib/actions/api-keys.actions";

/**
 * Global env switcher — lives in the main sidebar footer above the user
 * row. Ghost-style sidebar button: colored dot + env name + chevron.
 *
 * Paper: muted gray dot, static. Live: red dot, pulses to keep the
 * real-money state present in peripheral vision the whole session.
 *
 * Sets a cookie that every server component reads via
 * `getCurrentEnvironment()`. Hidden until the user has any live key /
 * position / analyst, so a paper-only user sees no chrome they can't use.
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
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton disabled={pending} />}>
            <EnvDot env={current} />
            <span className="flex-1 truncate">{isLive ? "Live" : "Paper"}</span>
            <ChevronsUpDown className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-40">
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
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function EnvDot({ env }: { env: AlpacaEnvironment }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full shrink-0",
        env === "LIVE"
          ? "bg-negative animate-pulse"
          : "bg-muted-foreground/50",
      )}
      aria-hidden
    />
  );
}
