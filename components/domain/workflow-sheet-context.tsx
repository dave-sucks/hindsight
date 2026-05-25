"use client";

/**
 * WorkflowSheetContext — exposes the "open tool dialog" handler from
 * TeamSheetContent down to <WorkflowMarkdown> so inline data-flow rows
 * can trigger the same tool detail dialog already used by the Tools
 * section at the bottom of the sheet.
 *
 * Defined at module scope (not co-located in team-card.tsx) so the
 * markdown renderer can import the hook without dragging team-card's
 * client dependencies along.
 */

import { createContext, useContext, type ReactNode } from "react";

export interface WorkflowSheetContextValue {
  /** Open the existing tool detail dialog for a tool by snake_case name. */
  openToolByName: (name: string) => void;
}

const WorkflowSheetContext = createContext<WorkflowSheetContextValue | null>(null);

export function WorkflowSheetProvider({
  value,
  children,
}: {
  value: WorkflowSheetContextValue;
  children: ReactNode;
}) {
  return (
    <WorkflowSheetContext.Provider value={value}>
      {children}
    </WorkflowSheetContext.Provider>
  );
}

export function useWorkflowSheet(): WorkflowSheetContextValue | null {
  return useContext(WorkflowSheetContext);
}
