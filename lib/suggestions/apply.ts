/**
 * Apply an approved suggestion's proposedDiff to the analyst's state.
 *
 * Called from lib/actions/suggestion.actions.ts:approveSuggestion after
 * the caller has re-verified ownership. All writes go through the existing
 * write surfaces (updateAnalystField for AgentConfig columns, direct
 * Monitor CRUD for intelligence queries) so canonical normalization,
 * audit, and revalidation fire exactly once per field.
 */

import { prisma } from "@/lib/prisma";
import { updateAnalystField } from "@/lib/actions/analyst.actions";
import type { ProposedDiff } from "./types";

interface ApplyContext {
  analystId: string;
  userId: string;
}

/**
 * Apply a proposedDiff to the analyst. Throws if the analyst is missing or
 * if the diff can't be applied (e.g. a monitor was deleted out from under
 * us between proposal time and approval time).
 */
export async function applyProposedDiff(
  diff: ProposedDiff,
  ctx: ApplyContext,
): Promise<void> {
  const { analystId, userId } = ctx;

  // Re-fetch current state so add/remove operations on array columns and
  // monitors are idempotent and atomic within this apply call.
  const config = await prisma.agentConfig.findFirst({
    where: { id: analystId, userId },
    select: {
      sectors: true,
      industries: true,
      themes: true,
      watchlist: true,
      exclusionList: true,
    },
  });
  if (!config) {
    throw new Error(`Analyst ${analystId} not found for user ${userId}`);
  }

  switch (diff.kind) {
    case "PROMPT_EDIT":
      await updateAnalystField(analystId, "analystPrompt", diff.nextAnalystPrompt);
      return;

    case "UNIVERSE_ADD_SECTOR": {
      const next = addUnique(config.sectors, diff.sector);
      await updateAnalystField(analystId, "sectors", next);
      return;
    }
    case "UNIVERSE_REMOVE_SECTOR": {
      const next = config.sectors.filter((s) => s !== diff.sector);
      await updateAnalystField(analystId, "sectors", next);
      return;
    }

    case "UNIVERSE_ADD_INDUSTRY": {
      const next = addUnique(config.industries, diff.industry);
      await updateAnalystField(analystId, "industries", next);
      return;
    }
    case "UNIVERSE_REMOVE_INDUSTRY": {
      const next = config.industries.filter((i) => i !== diff.industry);
      await updateAnalystField(analystId, "industries", next);
      return;
    }

    case "UNIVERSE_ADD_THEME": {
      // normalizeThemes inside updateAnalystField will uppercase + snake_case.
      const next = [...config.themes, diff.theme];
      await updateAnalystField(analystId, "themes", next);
      return;
    }
    case "UNIVERSE_REMOVE_THEME": {
      // Compare after normalization so "AI Infrastructure" matches "AI_INFRASTRUCTURE".
      const target = diff.theme.trim().toUpperCase().replace(/\s+/g, "_");
      const next = config.themes.filter((t) => t !== target);
      await updateAnalystField(analystId, "themes", next);
      return;
    }

    case "WATCHLIST_ADD": {
      const next = addUnique(config.watchlist, diff.ticker.toUpperCase());
      await updateAnalystField(analystId, "watchlist", next);
      return;
    }
    case "WATCHLIST_REMOVE": {
      const target = diff.ticker.toUpperCase();
      const next = config.watchlist.filter((t) => t !== target);
      await updateAnalystField(analystId, "watchlist", next);
      return;
    }

    case "EXCLUSION_ADD": {
      const next = addUnique(config.exclusionList, diff.ticker.toUpperCase());
      await updateAnalystField(analystId, "exclusionList", next);
      return;
    }

    case "INTELLIGENCE_QUERY_ADD": {
      // Create a USER-origin SEARCH monitor. Origin is "USER" — the user
      // explicitly approved the suggestion, so provenance is user-consented.
      // The source run / proposal history lives on the Suggestion row.
      await prisma.monitor.create({
        data: {
          name: diff.query,
          type: "SEARCH",
          method: "perplexity_sonar",
          config: { query: diff.query },
          scope: "ANALYST",
          analystId,
          enabled: true,
          builtIn: false,
          origin: "USER",
          category: diff.category,
        },
      });
      return;
    }
    case "INTELLIGENCE_QUERY_REMOVE": {
      // Only remove if the monitor still belongs to this analyst. If the
      // monitor was deleted between proposal and approval we silently
      // treat that as already-applied.
      const monitor = await prisma.monitor.findFirst({
        where: { id: diff.monitorId, analystId },
        select: { id: true },
      });
      if (monitor) {
        await prisma.monitor.delete({ where: { id: monitor.id } });
      }
      return;
    }

    case "META_COMMENTARY":
      // No structural change. Approving META_COMMENTARY is equivalent to
      // the user saying "ack, I read this" — status flips to APPROVED but
      // nothing else happens.
      return;
  }
}

function addUnique<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr : [...arr, v];
}
