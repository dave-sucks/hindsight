/** Shape of a single run event row from the DB or synthesized. */
export type RunEventRow = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  payload: unknown;
  createdAt: Date | string;
};
