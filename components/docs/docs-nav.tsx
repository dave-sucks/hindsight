"use client";

/** The two halves of /docs: the Guide (what it does) and the Framework (how an agent is put together). */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/docs", label: "Guide" },
  { href: "/docs/framework", label: "The Framework" },
] as const;

export function DocsNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Docs" className="inline-flex items-center gap-0.5 self-start rounded-lg border bg-muted/50 p-0.5">
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
  );
}
