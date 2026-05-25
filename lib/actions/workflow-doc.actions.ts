"use server";

/**
 * Server action exposing workflow-doc content to the client `/agent-workflow`
 * page. The reader (`lib/agent/workflow-content.ts`) uses `fs.readFileSync`
 * which is server-only — this thin wrapper lets the client TeamSheetContent
 * fetch the markdown body when the sheet opens.
 *
 * Returns null when the agent doesn't (yet) have a markdown file — callers
 * fall back to the legacy hand-typed description + substeps fields on the
 * registry entry so we can migrate one agent at a time.
 */

import { getWorkflowContent } from "@/lib/agent/workflow-content";

export async function loadWorkflowDoc(id: string): Promise<{
  body: string;
  summary: string | null;
} | null> {
  const content = getWorkflowContent(id);
  if (!content) return null;
  return {
    body: content.body,
    summary: content.frontmatter.summary ?? null,
  };
}
