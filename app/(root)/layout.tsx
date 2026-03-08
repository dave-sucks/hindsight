import Sidebar from "@/components/Sidebar";
import { auth } from "@/lib/better-auth/auth";
import { searchStocks } from "@/lib/actions/finnhub.actions";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const Layout = async ({ children }: { children: React.ReactNode }) => {
    const session = await auth.api.getSession({ headers: await headers() });

    if (!session?.user) redirect('/sign-in');

    const user = {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email,
    };

    const initialStocks = await searchStocks();

    return (
        <div className="flex min-h-screen bg-background">
            <Sidebar user={user} initialStocks={initialStocks} />

            {/* Desktop: offset for fixed sidebar; Mobile: offset for fixed top bar */}
            <main className="flex-1 md:ml-60 min-h-screen pt-14 md:pt-0">
                {children}
            </main>
        </div>
    );
};

export default Layout;
