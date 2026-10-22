"use server";

/**
 * Stop when buying — read and save the setting at the account or analyst
 * level (lib/trading/auto-stop.ts). Anyone who can edit the trigger rules
 * can edit it; a viewer sees it read-only.
 */

import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { getAccountId, getUserRole } from "@/lib/auth/account";
import { autoStopPctProblem } from "@/lib/trading/auto-stop";

export interface AutoStopView {
  account: { on: boolean; pct: number };
  /** The analyst's own values; null where it uses the account's. Absent at the account level. */
  analyst?: { on: boolean | null; pct: number | null };
  canEdit: boolean;
}

type Level = "account" | "analyst";

async function load(level: Level, ownerId: string): Promise<{ view: AutoStopView; accountId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const accountId = await getAccountId(user.id);
  if (!accountId) throw new Error("No account");
  if (level === "account" && ownerId !== accountId) throw new Error("Forbidden");
  const analyst =
    level === "analyst"
      ? await prisma.agentConfig.findFirst({ where: { id: ownerId, accountId }, select: { autoStopOnBuy: true, autoStopPct: true } })
      : null;
  if (level === "analyst" && !analyst) throw new Error("Not found");
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId }, select: { autoStopOnBuy: true, autoStopPct: true } });
  const role = await getUserRole(user.id, accountId);
  return {
    accountId,
    view: {
      account: { on: account.autoStopOnBuy, pct: account.autoStopPct },
      ...(analyst ? { analyst: { on: analyst.autoStopOnBuy, pct: analyst.autoStopPct } } : {}),
      canEdit: role != null && role !== "VIEWER",
    },
  };
}

export async function getAutoStop(level: Level, ownerId: string): Promise<AutoStopView> {
  return (await load(level, ownerId)).view;
}

/** Saves both values as this level's own; `reset` puts an analyst back on the account's. */
export async function saveAutoStop(
  input: { level: Level; ownerId: string } & ({ on: boolean; pct: number } | { reset: true }),
): Promise<{ ok: true; view: AutoStopView } | { ok: false; error: string }> {
  try {
    const { view, accountId } = await load(input.level, input.ownerId);
    if (!view.canEdit) return { ok: false, error: "You can view this setting but not change it." };
    if ("reset" in input) {
      if (input.level !== "analyst") return { ok: false, error: "The account setting is the default; there is nothing under it." };
      await prisma.agentConfig.update({ where: { id: input.ownerId }, data: { autoStopOnBuy: null, autoStopPct: null } });
    } else {
      const problem = autoStopPctProblem(input.pct);
      if (problem) return { ok: false, error: problem };
      const data = { autoStopOnBuy: input.on, autoStopPct: input.pct };
      if (input.level === "account") await prisma.account.update({ where: { id: accountId }, data });
      else await prisma.agentConfig.update({ where: { id: input.ownerId }, data });
    }
    return { ok: true, view: (await load(input.level, input.ownerId)).view };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save the setting." };
  }
}
