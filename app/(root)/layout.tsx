import Sidebar from "@/components/Sidebar";
import { createClient } from "@/lib/supabase/server";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { redirect } from "next/navigation";

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
        <div className="flex min-h-screen bg-background">
            <Sidebar user={userObj} initialStocks={initialStocks} />

            {/* Desktop: offset for fixed sidebar; Mobile: offset for fixed top bar */}
            <main className="flex-1 md:ml-60 min-h-screen pt-14 md:pt-0">
                {children}
            </main>
        </div>
    );
};

export default Layout;
