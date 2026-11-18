/**
 * setup-checklist.ts — the compact playbook block a thesis row carries into
 * every run (DAV-253): what a review checks, from the playbook the stock was
 * written on, and, on a stock we don't hold, the playbook's "Sell if below",
 * the one trigger that comes with the buy the run names (the fill writes the
 * rest, withTheBuyTriggers).
 */

import { getSetup, templatePlaceholders } from "./setups";
import type { SetupOverrides } from "./setup-overrides";
import type { Template } from "./playbook-templates";
import { playbookTriggerText } from "./playbooks";
import { playbookChecks } from "@/lib/agent/analyst-brief";

export interface SetupChecklist {
  id: string;
  name: string;
  /** What must still be true for the setup to be working. */
  failureSigns: string[];
  /** What a fire checks (playbookChecks' decision cut), and on a watch the playbook's "Sell if below": a row's `playbook_checks`. */
  lines: string[];
}

export function setupChecklist(
  setupId: string | null | undefined,
  opts: { overrides?: SetupOverrides; held?: boolean; templates?: Template[] | null } = {},
): SetupChecklist | null {
  if (!setupId) return null;
  const s = getSetup(setupId, opts.overrides);
  if (!s) return null;
  return {
    id: s.id,
    name: s.name,
    failureSigns: s.failureSigns,
    lines: [...playbookChecks(s, "decision"), ...(opts.held || opts.templates === undefined ? [] : playbookTriggerText(opts.templates && opts.templates.filter(isTheSale), "PROPOSAL"))],
  };
}

/** The "Sell if below {sellPrice}" template: the sale the run names with the buy (place_trade's sell_if_below). */
const isTheSale = (t: Template) => t.action === "EXIT" && templatePlaceholders(t.predicate).includes("{sellPrice}");
