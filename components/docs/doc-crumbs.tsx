/** Where a doc sits, as Linear writes it: the parent muted, the page in full ink. "Agents / Discovery". */

import Link from "next/link";

export function DocCrumbs({ group, title, groupHref }: { group: string; title: string; groupHref?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      {groupHref ? (
        <Link href={groupHref} className="text-muted-foreground transition-colors hover:text-foreground">
          {group}
        </Link>
      ) : (
        <span className="text-muted-foreground">{group}</span>
      )}
      <span className="text-muted-foreground/50" aria-hidden>
        /
      </span>
      <span className="truncate text-foreground" aria-current="page">
        {title}
      </span>
    </nav>
  );
}
