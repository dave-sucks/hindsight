import { Spinner } from "@/components/ui/spinner";

/** What a page shows from the click until its data arrives (the loading.tsx files). */
export function PageLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
      <Spinner />
      <span>Loading…</span>
    </div>
  );
}
