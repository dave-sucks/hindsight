/**
 * stock_table: every stock the account holds and watches, one line each with
 * the same columns (lib/agent/stock-table.ts). The table an analyst's run
 * gets for its own stocks inside its get_theses read, here for the account.
 * The run page shows the same rows as get_theses's card (lib/agent/book-card.ts).
 */
import { stockTableLines, type StockTable } from "@/lib/agent/stock-table";
import { once, type ContextRun, type Fact } from "./fact";
import type { SubjectOf } from "./bundles";

/** The table as the first message prints it, under its heading. */
export function stockTableText(table: StockTable | null): string {
  return table ? ["## The stock table", ...stockTableLines(table)].join("\n") : "## The stock table\nThe stocks couldn't be read this run.";
}

/** The account's table as a read of get_theses holds it on the screen: no rows opened, the table. */
const onScreen = (table: StockTable) => ({
  ok: true as const,
  ui: "thesis-card" as const,
  summary: `${table.rows.length} stock${table.rows.length === 1 ? "" : "s"}.`,
  data: { count: table.rows.length, theses: [], stocks: table, cards: [] },
  sources: [],
});

function read(run: ContextRun<SubjectOf<"account">>) {
  // Under the book's key, so the run page shows it where an analyst's book goes (the-book.ts `bookOnScreen`).
  return once(run, "the-book", async () => {
    const { loadStockTable } = await import("@/lib/agent/stock-table-load");
    const { resolveAlpacaCredentials } = await import("@/lib/actions/api-keys.actions");
    const { userId, accountId, environment } = run.subject;
    const alpacaCreds = (await resolveAlpacaCredentials(userId, environment).catch(() => null)) ?? undefined;
    const table = await loadStockTable({ userId, accountId, environment, alpacaCreds, now: run.now });
    return table ? { forModel: { data: table }, onScreen: onScreen(table) } : null;
  });
}

export const stockTable: Fact = {
  account: async (run) => stockTableText(((await read(run))?.forModel.data as StockTable | undefined) ?? null),
};
