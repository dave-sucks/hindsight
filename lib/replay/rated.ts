/**
 * A Writer decision saved before the thesis fields (2026-11-24), as the Writer
 * sends it now. Its assumptions and what would prove it wrong are its KPIs, in
 * that order, as the migration copied them. Its outlook's reason is its opinion.
 * The company and the bull and bear cases, which were the research note's
 * sections, come with it as this replay's own lines. A field it already has
 * is left as it is.
 */
export function writtenNow<T>(decision: T): T {
  const { key_assumptions, invalidation_conditions, outlook_reason, variant_view, ...rest } = decision as Record<string, unknown>;
  void variant_view;
  const lines = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const kpis = [...lines(key_assumptions), ...lines(invalidation_conditions)];
  return {
    company: "The company this replay saved; its business was in the research note's Company section, which the save now takes as a field.",
    bull_case: ["The first bull line this replay's note carried.", "The second bull line this replay's note carried."],
    bear_case: ["The first risk this replay's note carried; the sign is the next report.", "The second risk this replay's note carried; the sign is the next report."],
    ...(kpis.length ? { kpis } : {}),
    ...(typeof outlook_reason === "string" && outlook_reason.trim() ? { opinion: outlook_reason } : {}),
    ...rest,
  } as T;
}

/**
 * A Writer decision saved before the Writer had to say what it expects of the
 * stock (2026-11-20), as the Writer sends it now: with an outlook and its
 * opinion, and with the thesis fields (`writtenNow`). One that already has
 * them is left as it is.
 */
export function ratedNow<T>(decision: T): T {
  return { outlook: "BULLISH", opinion: "Rated for this replay: the saved decision predates the outlook.", ...(writtenNow(decision) as object) } as T;
}

/**
 * A record_thesis or update_thesis call sent before the thesis fields
 * (2026-11-24), as it is sent now: its assumptions and what would prove it
 * wrong are its KPIs, in that order; its outlook's reason is its opinion; it
 * has no variant view.
 */
export function claimNow<T>(call: T): T {
  const { key_assumptions, invalidation_conditions, outlook_reason, variant_view, ...rest } = call as Record<string, unknown>;
  void variant_view;
  const lines = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const kpis = [...lines(key_assumptions), ...lines(invalidation_conditions)];
  return {
    ...(kpis.length ? { kpis } : {}),
    ...(typeof outlook_reason === "string" ? { opinion: outlook_reason } : {}),
    ...rest,
  } as T;
}
