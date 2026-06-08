import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAccountId } from '@/lib/auth/account';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { SettingsSidebar } from '@/components/settings/SettingsSidebar';

/**
 * Settings shell — replaces the main app sidebar (from `(root)/layout.tsx`)
 * for everything under /settings. Auth check mirrors the main shell; the
 * "Back to app" link lives inside SettingsSidebar.
 */
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/sign-in');
  const accountId = await getAccountId(user.id);
  if (!accountId) redirect('/sign-in');

  return (
    <SidebarProvider>
      <SettingsSidebar />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
        </header>
        <main className="flex-1">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
