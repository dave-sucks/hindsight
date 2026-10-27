'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  DashboardSquare01Icon,
  BubbleChatIcon,
  RoboticIcon,
  Mic01Icon,
  ChartCandlestickIcon,
  PlayCircleIcon,
  ArrowDataTransferHorizontalIcon,
  Analytics01Icon,
  Settings01Icon,
  Logout01Icon,
  UnfoldMoreIcon,
  Wallet01Icon,
  Sun03Icon,
  Moon02Icon,
  WorkflowSquare03Icon,
  BookOpen01Icon,
  SparklesIcon,
  Cancel01Icon,
} from '@hugeicons/core-free-icons';
import { UserBlob } from '@/components/UserBlob';
import { SidebarMarquee } from '@/components/MarketPulseStrip';
import { EnvironmentSwitcher } from '@/components/settings/EnvironmentSwitcher';
import type { AlpacaEnvironment } from '@/lib/actions/api-keys.actions';
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
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { signOut } from '@/lib/actions/auth.actions';

// Podcasts is gated behind NEXT_PUBLIC_PODCASTS_ENABLED so the UI can stay
// hidden in production until we're ready to show it. Code is always deployed,
// pages are always navigable directly via URL — the flag only controls
// whether the sidebar entry shows. See docs/PODCAST_PLAN.md.
const PODCASTS_ENABLED = process.env.NEXT_PUBLIC_PODCASTS_ENABLED === "true";

type NavItem = { href: string; label: string; icon: IconSvgElement; tooltip: string };

const MAIN_NAV: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: DashboardSquare01Icon, tooltip: 'Portfolio overview' },
  { href: '/chat', label: 'Chat', icon: BubbleChatIcon, tooltip: 'Principal chat — talk to everything' },
  { href: '/analysts', label: 'Analysts', icon: RoboticIcon, tooltip: 'AI trading personas' },
  ...(PODCASTS_ENABLED
    ? [{ href: '/podcasts', label: 'Podcasts', icon: Mic01Icon, tooltip: 'AI-generated podcasts (PoC)' }]
    : []),
  { href: '/market', label: 'Market', icon: ChartCandlestickIcon, tooltip: 'Earnings, filings, movers and signals' },
  { href: '/runs', label: 'Runs', icon: PlayCircleIcon, tooltip: 'Research sessions' },
];

const PORTFOLIO_NAV: NavItem[] = [
  { href: '/trades', label: 'Trades', icon: ArrowDataTransferHorizontalIcon, tooltip: 'Paper trades and P&L' },
  { href: '/performance', label: 'Performance', icon: Analytics01Icon, tooltip: 'Win rate and accuracy' },
];

export default function AppSidebar({
  user,
  initialStocks,
  portfolioValue,
  openTradeTickers = [],
  onProductTour,
  currentEnv,
  exposeLive,
}: {
  user: User;
  initialStocks: StockWithWatchlistStatus[];
  portfolioValue: number;
  openTradeTickers?: string[];
  onProductTour?: () => void;
  currentEnv: AlpacaEnvironment;
  exposeLive: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { isMobile, setOpenMobile } = useSidebar();

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
      {/* Account switcher (Paper / Live) — the whole header; no logo. A
          SidebarMenuButton like the nav rows, so hover width and padding
          match them. */}
      <SidebarHeader>
        <div className="flex items-center gap-1">
          {exposeLive && (
            <SidebarMenu className="flex-1 min-w-0">
              <SidebarMenuItem>
                <EnvironmentSwitcher current={currentEnv} />
              </SidebarMenuItem>
            </SidebarMenu>
          )}
          {isMobile && (
            <button
              onClick={() => setOpenMobile(false)}
              className="ml-auto flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors shrink-0"
              aria-label="Close navigation"
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
            </button>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        <TooltipProvider delay={400}>
          {/* Main nav */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {MAIN_NAV.map(({ href, label, icon, tooltip }) => (
                  <SidebarMenuItem key={href}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <SidebarMenuButton
                            render={<Link href={href} />}
                            isActive={isActive(href)}
                            onClick={() => isMobile && setOpenMobile(false)}
                          >
                            <HugeiconsIcon icon={icon} />
                            <span>{label}</span>
                          </SidebarMenuButton>
                        }
                      />
                      <TooltipContent side="right">
                        <p className="text-xs">{tooltip}</p>
                      </TooltipContent>
                    </Tooltip>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Portfolio group */}
          <SidebarGroup>
            <SidebarGroupLabel>Portfolio</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {PORTFOLIO_NAV.map(({ href, label, icon, tooltip }) => (
                  <SidebarMenuItem key={href}>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <SidebarMenuButton
                            render={<Link href={href} />}
                            isActive={isActive(href)}
                            onClick={() => isMobile && setOpenMobile(false)}
                          >
                            <HugeiconsIcon icon={icon} />
                            <span>{label}</span>
                          </SidebarMenuButton>
                        }
                      />
                      <TooltipContent side="right">
                        <p className="text-xs">{tooltip}</p>
                      </TooltipContent>
                    </Tooltip>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </TooltipProvider>
      </SidebarContent>

      {/* Ticker marquee — above user footer */}
      <SidebarMarquee openTradeTickers={openTradeTickers} />

      {/* User footer */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SidebarMenuButton size="lg" />}
                className="data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground"
              >
                <UserBlob size={28} />
                <p className="flex-1 min-w-0 text-left text-sm font-medium truncate">{user.name}</p>
                <HugeiconsIcon icon={UnfoldMoreIcon} className="ml-auto text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start">
                {/* Portfolio value — DropdownMenuLabel is Menu.GroupLabel which requires Menu.Group wrapper */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <HugeiconsIcon icon={Wallet01Icon} className="size-3.5" />
                      <span>Portfolio</span>
                      <span className="ml-auto font-semibold text-foreground tabular-nums">
                        {formattedPortfolio}
                      </span>
                    </div>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />

                {/* Settings — onClick only, no render={<Link>} to avoid Base UI / Next router conflict */}
                <DropdownMenuItem onClick={() => router.push('/settings')}>
                  <HugeiconsIcon icon={Settings01Icon} />
                  Settings
                </DropdownMenuItem>

                <DropdownMenuItem onClick={() => router.push('/how-it-works')}>
                  <HugeiconsIcon icon={WorkflowSquare03Icon} />
                  How it works
                </DropdownMenuItem>

                <DropdownMenuItem onClick={() => router.push('/docs')}>
                  <HugeiconsIcon icon={BookOpen01Icon} />
                  Docs
                </DropdownMenuItem>

                <DropdownMenuItem onClick={() => onProductTour?.()}>
                  <HugeiconsIcon icon={SparklesIcon} />
                  Product Tour
                </DropdownMenuItem>

                {/* Theme toggle */}
                <DropdownMenuItem onClick={() => setTheme(isDark ? 'light' : 'dark')}>
                  {isDark ? (
                    <HugeiconsIcon icon={Sun03Icon} />
                  ) : (
                    <HugeiconsIcon icon={Moon02Icon} />
                  )}
                  {isDark ? 'Light mode' : 'Dark mode'}
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
                  <HugeiconsIcon icon={Logout01Icon} />
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
