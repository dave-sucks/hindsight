'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, User, Users, Plug } from 'lucide-react';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';

const NAV = [
  { href: '/settings/profile', label: 'Profile', icon: User },
  { href: '/settings/team', label: 'Team', icon: Users },
  { href: '/settings/connections', label: 'Connections', icon: Plug },
];

/**
 * Settings sidebar — replaces the main app sidebar for /settings routes.
 * Mirrors the Linear settings pattern: a "Back to app" link up top + a flat
 * list of section links. No collapsibles, no nested groups.
 */
export function SettingsSidebar() {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton render={<Link href="/" />}>
              <ArrowLeft />
              <span>Back to app</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    render={<Link href={href} />}
                    isActive={isActive(href)}
                    onClick={() => isMobile && setOpenMobile(false)}
                  >
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
