/**
 * setup-checklist.ts — the compact setup block a thesis row carries into
 * every run (DAV-253): what a review checks, from the setup the stock was
 * written on, and, on a stock we don't hold, the playbook's lines that come
 * with the buy, for the run that proposes it.
 */

import { getSetup } from "./setups";
import type { SetupOverrides } from "./setup-overrides";
import type { Template } from "./playbook-templates";
import { playbookLines } from "./playbooks";
import { setupLines } from "@/lib/agent/analyst-brief";

export interface SetupChecklist {
  id: string;
  name: string;
  /** What must still be true for the setup to be working. */
  failureSigns: string[];
  /** The lines a fire checks (setupLines' decision cut), and on a watch the playbook's With the buy lines: a row's `setup_lines`. */
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
    lines: [...setupLines(s, "decision"), ...(opts.held || opts.templates === undefined ? [] : playbookLines(opts.templates, "PROPOSAL"))],
  };
}
