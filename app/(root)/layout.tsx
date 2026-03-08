import Header from "@/components/Header";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const Layout = async ({ children }: { children: React.ReactNode }) => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) redirect('/sign-in');

    const { data: profile } = await supabase
        .from('users')
        .select('id, name, email')
        .eq('id', user.id)
        .single();

    const userProfile = {
        id: user.id,
        name: profile?.name ?? user.email ?? '',
        email: user.email ?? '',
    };

    return (
        <main className="min-h-screen text-gray-400">
            <Header user={userProfile} />

            <div className="container py-10">
                {children}
            </div>
        </main>
    )
}
export default Layout
