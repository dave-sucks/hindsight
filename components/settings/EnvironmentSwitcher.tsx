"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { HugeiconsIcon } from "@hugeicons/react";
import { UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { setCurrentEnvironment } from "@/lib/actions/environment.actions";
import type { AlpacaEnvironment } from "@/lib/actions/api-keys.actions";

/**
 * Global env switcher — the sidebar header. The trigger is a
 * SidebarMenuButton (render inside a SidebarMenuItem) so it lines up with the
 * nav rows; the menu takes the trigger's width (the DropdownMenuContent
 * default). Same chevron as the profile button in the footer.
 *
 * Paper: muted gray dot, static. Live: blue pulsing dot (matches the
 * "Holding" trade status dot).
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
        render={<SidebarMenuButton disabled={pending} />}
        className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground"
      >
        <EnvDot env={current} />
        <span className="flex-1 truncate text-left">{isLive ? "Live" : "Paper"}</span>
        <HugeiconsIcon icon={UnfoldMoreIcon} className="text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start">
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

/** The account dot: Live pulses blue, Paper is grey. Shared with the Trade dialog. */
export function EnvDot({ env }: { env: AlpacaEnvironment }) {
  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full shrink-0",
        env === "LIVE"
          ? "bg-brand-blue animate-pulse"
          : "bg-muted-foreground/50",
      )}
      aria-hidden
    />
  );
}
