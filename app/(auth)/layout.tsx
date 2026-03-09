import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import HindsightLogo from "@/components/HindsightLogo";

const Layout = async ({ children }: { children : React.ReactNode }) => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) redirect('/')

    return (
        <main className="flex min-h-screen bg-background">
            <section className="flex flex-col flex-1 max-w-md mx-auto px-8 py-12 overflow-y-auto">
                <Link href="/" className="mb-10 flex items-center gap-2.5">
                    <HindsightLogo className="size-6 text-brand" />
                    <span className="text-xl font-bold text-foreground tracking-tight">Hindsight</span>
                </Link>

                <div className="flex-1">{children}</div>
            </section>

            <section className="hidden lg:flex flex-col flex-1 bg-card border-l border-border px-12 py-12 overflow-hidden">
                <div className="z-10 relative mt-auto mb-16">
                    <blockquote className="text-lg font-medium text-foreground leading-relaxed mb-6">
                        &ldquo;The AI research is genuinely impressive. It catches patterns I would have missed and explains exactly why each trade makes sense.&rdquo;
                    </blockquote>
                    <div className="flex items-center justify-between">
                        <div>
                            <cite className="text-sm font-semibold text-foreground not-italic">- Ethan R.</cite>
                            <p className="text-xs text-muted-foreground mt-0.5">Retail Investor</p>
                        </div>
                    </div>
                </div>
            </section>
        </main>
    )
}
export default Layout
