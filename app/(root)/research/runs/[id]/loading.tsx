export default function RunDetailLoading() {
  return (
    <div className="flex h-[calc(100dvh-5.25rem)] overflow-hidden">
      {/* Left column */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="px-6 pt-6 pb-4 border-b animate-pulse">
          <div className="h-3 w-24 bg-muted rounded mb-4" />
          <div className="flex items-start gap-3">
            <div className="h-9 w-9 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-5 w-48 bg-muted rounded" />
              <div className="h-3 w-32 bg-muted rounded" />
            </div>
          </div>
        </div>
        <div className="p-6 grid gap-4 sm:grid-cols-2 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card h-64" />
          ))}
        </div>
      </div>
      {/* Right column */}
      <div className="hidden lg:block w-[420px] border-l bg-muted/20" />
    </div>
  );
}
