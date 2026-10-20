"use client";

/**
 * The docs' own sidebar, in place of the app's under /docs. Built from the
 * same sidebar parts as the app's (components/ui/sidebar), so a change to
 * how a group label or a menu item looks lands in both. The logo goes back
 * to the app and "Docs" to the docs' front door; the footer holds the app
 * and the tour as icon buttons, the way Linear's docs do.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { House, Layers, Workflow, type LucideIcon } from "lucide-react";
import HindsightLogo from "@/components/HindsightLogo";
import { buttonVariants } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DOCS, GROUPS, OVERVIEW, docHref } from "./registry";

const OUT: ReadonlyArray<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/", label: "Back to app", icon: House },
  { href: "/how-it-works", label: "How it works", icon: Workflow },
  { href: "/how-it-works/framework", label: "The Framework", icon: Layers },
];

export function DocsSidebar() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => isMobile && setOpenMobile(false);

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <div className="flex w-full items-center gap-1 px-1 py-1">
          <Link
            href="/"
            onClick={close}
            aria-label="Back to app"
            className="flex shrink-0 items-center justify-center rounded-md p-1.5 text-brand transition-colors hover:bg-sidebar-accent"
          >
            <HindsightLogo className="size-4" />
          </Link>
          <Link href="/docs" onClick={close} className="rounded-md px-1.5 py-1 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent">
            Docs
          </Link>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((g) => {
          const docs = DOCS.filter((d) => d.group === g.group);
          const items = g.group === "Overview" ? [{ slug: OVERVIEW, title: "Overview" }, ...docs] : docs;
          return (
            <SidebarGroup key={g.label}>
              <SidebarGroupLabel>{g.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((d) => {
                    const href = docHref(d.slug);
                    return (
                      <SidebarMenuItem key={d.slug}>
                        <SidebarMenuButton render={<Link href={href} />} isActive={pathname === href} onClick={close}>
                          <span>{d.title}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>

      <SidebarFooter>
        <TooltipProvider delay={400}>
          <div className="flex items-center gap-1">
            {OUT.map(({ href, label, icon: Icon }) => (
              <Tooltip key={href}>
                <TooltipTrigger
                  render={
                    <Link href={href} aria-label={label} onClick={close} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
                      <Icon />
                    </Link>
                  }
                />
                <TooltipContent side="top">
                  <p className="text-xs">{label}</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </SidebarFooter>
    </Sidebar>
  );
}
