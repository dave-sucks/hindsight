"use client";

/** The tour's two tabs (how it works, and how an agent is put together), with the docs a button away on the right. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/how-it-works/framework", label: "The Framework" },
] as const;

export function DocsNav() {
  const pathname = usePathname();
  return (
    <div className="flex items-center justify-between gap-3">
      <nav aria-label="How it works" className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5">
        {TABS.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1 text-sm transition-colors",
                active ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <Link href="/docs" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        Docs
        <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" />
      </Link>
    </div>
  );
}
