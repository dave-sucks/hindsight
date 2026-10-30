"use client";

/** The tour's two tabs (how it works, and how an agent is put together), with the docs a button away on the right. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/how-it-works/framework", label: "The Framework" },
] as const;

export function DocsNav() {
  const pathname = usePathname();
  return (
    <div className="flex items-center justify-between gap-3">
      {/* Page tabs — the shared Tabs; each tab is a link, so the URL picks the active one. */}
      <Tabs value={pathname}>
        <TabsList aria-label="How it works">
          {TABS.map((t) => (
            <TabsTrigger key={t.href} value={t.href} nativeButton={false} render={<Link href={t.href} />}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Link href="/docs" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        Docs
        <HugeiconsIcon icon={ArrowUpRight01Icon} data-icon="inline-end" />
      </Link>
    </div>
  );
}
