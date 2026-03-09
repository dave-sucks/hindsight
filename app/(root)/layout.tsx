import AppSidebar from "@/components/Sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/ThemeToggle";
import MarketPulseStrip from "@/components/MarketPulseStrip";
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

    // Load open trade tickers and market status at request time (server-side)
    const [initialStocks, openTrades] = await Promise.all([
        searchStocks(),
        prisma.trade.findMany({
            where: { userId: user.id, status: "OPEN" },
            select: { thesis: { select: { ticker: true } } },
            take: 10,
        }),
    ]);

    const openTradeTickers = openTrades
        .map((t) => t.thesis?.ticker)
        .filter((t): t is string => Boolean(t));

    const marketOpen = isMarketOpen();

    return (
        <SidebarProvider>
            <AppSidebar user={userObj} initialStocks={initialStocks} />
            <SidebarInset>
                {/* Top bar — always visible, houses sidebar toggle + theme switcher */}
                <header className="flex h-12 items-center gap-2 border-b px-3 shrink-0">
                    <SidebarTrigger className="-ml-1" />
                    <Separator orientation="vertical" className="h-4" />
                    <div className="ml-auto">
                        <ThemeToggle />
                    </div>
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
