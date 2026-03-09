'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  LayoutDashboard,
  FlaskConical,
  ArrowLeftRight,
  BarChart3,
  TrendingUp,
  Settings,
  LogOut,
  ChevronsUpDown,
  Wallet,
  Sun,
  Moon,
} from 'lucide-react';
import HindsightLogo from '@/components/HindsightLogo';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOut } from '@/lib/actions/auth.actions';

const NAV_LINKS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/research', label: 'Research', icon: FlaskConical },
  { href: '/trades', label: 'Trades', icon: ArrowLeftRight },
  { href: '/performance', label: 'Performance', icon: BarChart3 },
  { href: '/stocks', label: 'Stocks', icon: TrendingUp },
];

export default function AppSidebar({
  user,
  initialStocks,
  portfolioValue,
}: {
  user: User;
  initialStocks: StockWithWatchlistStatus[];
  portfolioValue: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/sign-in');
  };

  const formattedPortfolio = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(portfolioValue);

  const isDark = theme === 'dark';

  return (
    <Sidebar collapsible="icon">
      {/* Brand */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <HindsightLogo className="size-5 shrink-0 text-brand" />
              <span className="font-semibold tracking-tight">Hindsight</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* Nav */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_LINKS.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    render={<Link href={href} />}
                    isActive={isActive(href)}
                    tooltip={label}
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

      {/* User footer — clickable dropdown */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SidebarMenuButton size="lg" />}
                className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground"
              >
                <Avatar className="h-7 w-7 rounded-md shrink-0">
                  <AvatarFallback className="rounded-md text-xs bg-brand text-brand-foreground font-semibold">
                    {user.name?.[0]?.toUpperCase() ?? '?'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 text-left overflow-hidden">
                  <p className="text-xs font-medium truncate">{user.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                </div>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                {/* Portfolio value */}
                <DropdownMenuLabel className="font-normal">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Wallet className="h-3.5 w-3.5" />
                    <span>Portfolio</span>
                    <span className="ml-auto font-semibold text-foreground tabular-nums">
                      {formattedPortfolio}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                {/* Settings — onClick only, no render={<Link>} to avoid Base UI / Next router conflict */}
                <DropdownMenuItem onClick={() => router.push('/settings')}>
                  <Settings className="h-3.5 w-3.5" />
                  Settings
                </DropdownMenuItem>

                {/* Theme toggle */}
                <DropdownMenuItem onClick={() => setTheme(isDark ? 'light' : 'dark')}>
                  {isDark ? (
                    <Sun className="h-3.5 w-3.5" />
                  ) : (
                    <Moon className="h-3.5 w-3.5" />
                  )}
                  {isDark ? 'Light mode' : 'Dark mode'}
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleSignOut}
                  className="text-destructive focus:text-destructive cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
