import AppSidebar from "@/components/Sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/ThemeToggle";
import MarketPulseStrip from "@/components/MarketPulseStrip";
import SearchCommand from "@/components/SearchCommand";
import { createClient } from "@/lib/supabase/server";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { redirect } from "next/navigation";
import { isMarketOpen } from "@/lib/market-hours";
import { prisma } from "@/lib/prisma";

const Layout = async ({ children }: { children: React.ReactNode }) => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) redirect('/sign-in');

    const userObj = {
        id: user.id,
        name: user.user_metadata?.full_name ?? user.email ?? '',
        email: user.email ?? '',
    };

    // Load open trade tickers, stocks list, and portfolio value at request time
    const [initialStocks, openTrades, pnlAggregate] = await Promise.all([
        searchStocks(),
        prisma.trade.findMany({
            where: { userId: user.id, status: "OPEN" },
            select: { thesis: { select: { ticker: true } } },
            take: 10,
        }),
        prisma.trade.aggregate({
            where: { userId: user.id, status: "CLOSED" },
            _sum: { realizedPnl: true },
        }),
    ]);

    const openTradeTickers = openTrades
        .map((t) => t.thesis?.ticker)
        .filter((t): t is string => Boolean(t));

    const marketOpen = isMarketOpen();

    // Start from a $100k paper account, add realized P&L
    const portfolioValue = 100_000 + (pnlAggregate._sum.realizedPnl ?? 0);

    return (
        <SidebarProvider>
            <AppSidebar user={userObj} initialStocks={initialStocks} portfolioValue={portfolioValue} />
            <SidebarInset>
                {/* Top bar — sidebar toggle + search + theme */}
                <header className="flex w-full h-12 items-center gap-2 border-b px-4 shrink-0">
                    <SidebarTrigger className="-ml-1" />
                    <Separator orientation="vertical" className="h-8" />
                    <div className="flex-1 flex items-center justify-center">
                        <SearchCommand renderAs="icon" label="Search stocks" initialStocks={initialStocks} />
                    </div>
                    <ThemeToggle />
                </header>
                <MarketPulseStrip openTradeTickers={openTradeTickers} marketOpen={marketOpen} />
                <main className="flex-1">
                    {children}
                </main>
            </SidebarInset>
        </SidebarProvider>
    );
};

export default Layout;
