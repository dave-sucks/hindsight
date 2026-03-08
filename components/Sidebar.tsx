'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  FlaskConical,
  ArrowLeftRight,
  BarChart3,
  TrendingUp,
  Settings,
  LogOut,
  Menu,
  BrainCircuit,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import SearchCommand from '@/components/SearchCommand';
import { signOut } from '@/lib/actions/auth.actions';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/research', label: 'Research', icon: FlaskConical },
  { href: '/trades', label: 'Trades', icon: ArrowLeftRight },
  { href: '/performance', label: 'Performance', icon: BarChart3 },
  { href: '/stocks', label: 'Stocks', icon: TrendingUp },
  { href: '/settings', label: 'Settings', icon: Settings },
];

function NavContent({
  user,
  initialStocks,
  onNavigate,
}: {
  user: User;
  initialStocks: StockWithWatchlistStatus[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/sign-in');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-4 py-5 shrink-0">
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-2.5"
        >
          <BrainCircuit className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold text-foreground tracking-tight">
            Hindsight
          </span>
        </Link>
      </div>

      {/* Search */}
      <div className="px-2 mb-1 shrink-0">
        <SearchCommand
          renderAs="icon"
          label="Search stocks"
          initialStocks={initialStocks}
        />
      </div>

      <Separator className="my-2" />

      {/* Nav links */}
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {NAV_LINKS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
              isActive(href)
                ? 'bg-secondary text-foreground'
                : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      {/* User section */}
      <div className="mt-auto shrink-0">
        <Separator />
        <div className="p-3 flex items-center gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
              {user.name?.[0]?.toUpperCase() ?? '?'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {user.name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {user.email}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSignOut}
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Sidebar({
  user,
  initialStocks,
}: {
  user: User;
  initialStocks: StockWithWatchlistStatus[];
}) {
  return (
    <>
      {/* Desktop sidebar — fixed, 240px */}
      <aside className="hidden md:flex fixed inset-y-0 left-0 z-50 w-60 flex-col border-r border-border bg-card">
        <NavContent user={user} initialStocks={initialStocks} />
      </aside>

      {/* Mobile: top bar with hamburger + Sheet drawer */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 flex items-center h-14 px-4 border-b border-border bg-card">
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open navigation</span>
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="p-0 w-60 bg-card border-border [&>button]:hidden"
          >
            <NavContent
              user={user}
              initialStocks={initialStocks}
            />
          </SheetContent>
        </Sheet>
        <Link href="/" className="flex items-center gap-2 ml-3">
          <BrainCircuit className="h-5 w-5 text-primary" />
          <span className="text-base font-semibold text-foreground">
            Hindsight
          </span>
        </Link>
      </div>
    </>
  );
}
