import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountId } from "@/lib/auth/account";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DocsSidebar } from "@/components/docs/docs-sidebar";

/**
 * Docs shell: replaces the app sidebar (from `(root)/layout.tsx`) for
 * everything under /docs, the way `(settings)` does. Auth mirrors the main
 * shell; the way back to the app is the logo and the footer of DocsSidebar.
 */
export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/sign-in");
  const accountId = await getAccountId(user.id);
  if (!accountId) redirect("/sign-in");

  return (
    <SidebarProvider>
      <DocsSidebar />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
        </header>
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
