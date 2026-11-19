/**
 * Marks a run's line that saved a change with no note (a trigger edit, a
 * conviction, a watch change; saveThesis). Only a note answers a stock: such
 * a line answers no fire, word, review or work-list stock (2026-11-18).
 */
export const NO_NOTE = { noNote: { from: null, to: true } } as const;
export const isNotelessEdit = (fieldChanges: unknown): boolean => !!(fieldChanges as { noNote?: unknown } | null)?.noNote;
