import AppSidebar from "@/components/Sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { createClient } from "@/lib/supabase/server";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { redirect } from "next/navigation";
import { BrainCircuit } from "lucide-react";
import Link from "next/link";

const Layout = async ({ children }: { children: React.ReactNode }) => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) redirect('/sign-in');

    const userObj = {
        id: user.id,
        name: user.user_metadata?.full_name ?? user.email ?? '',
        email: user.email ?? '',
    };

    const initialStocks = await searchStocks();

    return (
        <SidebarProvider>
            <AppSidebar user={userObj} initialStocks={initialStocks} />
            <SidebarInset>
                {/* Mobile top bar */}
                <header className="flex md:hidden h-12 items-center gap-2 border-b px-4 shrink-0">
                    <SidebarTrigger />
                    <Link href="/" className="flex items-center gap-2">
                        <BrainCircuit className="h-4 w-4" />
                        <span className="font-semibold text-sm">Hindsight</span>
                    </Link>
                </header>
                <main className="flex-1">
                    {children}
                </main>
            </SidebarInset>
        </SidebarProvider>
    );
};

export default Layout;
