export const RUN_EVENT_TYPES = {
  RUN_STARTED:               "run.started",
  STRATEGY_PARSED:           "strategy.parsed",
  DISCOVERY_STARTED:         "discovery.started",
  DISCOVERY_COMPLETED:       "discovery.completed",
  TICKER_RESEARCH_STARTED:   "ticker.research.started",
  DATA_GATHERING_COMPLETED:  "data_gathering.completed",
  TICKER_RESEARCH_COMPLETED: "ticker.research.completed",
  THESIS_GENERATED:          "thesis.generated",
  TRADE_PLAN_GENERATED:      "trade_plan.generated",
  TRADE_EXECUTED:            "trade.executed",
  TRADE_REJECTED:            "trade.rejected",
  RUN_COMPLETED:             "run.completed",
  RUN_ERROR:                 "run.error",
} as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[keyof typeof RUN_EVENT_TYPES];
