/**
 * Knowledge library — the structured "book of the firm" the Analyst
 * Builder/Editor/Manager agents consult when making decisions.
 *
 * Three catalogs, one unified entry point:
 *   - strategy archetypes — trading styles with edge, risk, prompt skeletons
 *   - source catalog — vetted research sources with quality scores
 *   - signal type catalog — the taxonomy of signals the router speaks
 *
 * Each file is safe to import independently. This index re-exports the
 * high-traffic symbols.
 */

export {
  STRATEGY_ARCHETYPES,
  getArchetype,
  archetypesByDirection,
  archetypeIndex,
  type StrategyArchetype,
  type HoldDuration,
  type DirectionBias,
} from "./strategy-archetypes";

export {
  SOURCE_CATALOG,
  getSource,
  sourcesByCategory,
  premiumSources,
  sourceIndex,
  resolveSourceIds,
  type SourceEntry,
  type SourceCategory,
} from "./source-catalog";

export {
  SIGNAL_TYPES,
  getSignalType,
  signalsByCategory,
  resolveSignalIds,
  allSignalIds,
  signalIndex,
  type SignalType,
  type SignalCategory,
} from "./signal-type-catalog";

export {
  PODCAST_FORMATS,
  getPodcastFormat,
  podcastFormatIndex,
  type PodcastFormat,
  type SegmentTemplate,
} from "./podcast-formats";

export {
  SETUPS,
  setupsForAnalyst,
  getSetup,
  setupIndex,
  describeTemplate,
  type Setup,
  type SetupId,
} from "./setups";
