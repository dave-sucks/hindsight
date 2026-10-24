import type { ReactNode } from "react";

/**
 * DetailPage — the ONE layout for a page about one thing (a thesis, a
 * stock): the main column on the left, a 320px column of cards on the
 * right that drops under the main column on a phone. Both pages use it, so
 * they can't drift apart.
 */
export function DetailPage({ main, aside }: { main: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">{main}</div>
        {aside ? <aside className="flex min-w-0 flex-col gap-4">{aside}</aside> : null}
      </div>
    </div>
  );
}
