// Re-export Prisma-generated types for convenience
// Note: Prisma v7 generates types with a "Model" suffix (e.g. PositionModel, not Position)
export type {
  ResearchRunModel as ResearchRun,
  ThesisModel as Thesis,
  AgentConfigModel as AgentConfig,
  UserModel as User,
  WatchlistItemModel as WatchlistItem,
  AnalystWatchlistItemModel as AnalystWatchlistItem,
  PositionModel as Position,
  OrderModel as Order,
  PositionEventModel as PositionEvent,
  TradeDecisionModel as TradeDecision,
} from "@/lib/generated/prisma/models";

// Derived / composite types

export type ResearchSource = "AGENT" | "MANUAL";
export type ResearchRunStatus = "PENDING" | "RUNNING" | "COMPLETE" | "FAILED";
export type TradeDirection = "LONG" | "SHORT";
export type ThesisDirection = "LONG" | "SHORT" | "PASS";
export type HoldDuration = "DAY" | "SWING" | "POSITION";
export type ExitStrategy = "PRICE_TARGET" | "TIME_BASED" | "TRAILING" | "MANUAL";
export type CloseReason = "TARGET" | "STOP" | "TIME" | "MANUAL";
export type TradeOutcome = "WIN" | "LOSS" | "BREAKEVEN";

// ─── Position types ──────────────────────────────────────────────────────────
export type PositionStatus = "OPEN" | "CLOSED" | "CANCELLED";
export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "STOP";
export type OrderStatus = "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";
export type PositionEventType =
  | "OPENED"
  | "PRICE_CHECK"
  | "NEAR_TARGET"
  | "CLOSED"
  | "EVALUATED"
  | "EOD_CHECK";
export type DecisionType = "BUY" | "SELL" | "HOLD" | "PASS";

// ─── Watchlist types ────────────────────────────────────────────────────────
export type WatchlistItemStatus = "ACTIVE" | "REMOVED" | "GRADUATED";
export type WatchlistItemPriority = "HIGH" | "NORMAL" | "LOW";
export type WatchlistItemAddedBy = "AGENT" | "USER" | "BUILDER";

// ─── Composite types ─────────────────────────────────────────────────────────

import type {
  ResearchRunModel,
  ThesisModel,
  PositionModel,
  OrderModel,
  PositionEventModel,
  TradeDecisionModel,
} from "@/lib/generated/prisma/models";

export type ThesisWithPosition = ThesisModel & {
  decisions: (TradeDecisionModel & { position: PositionModel | null })[];
};

export type ResearchRunWithTheses = ResearchRunModel & {
  theses: (ThesisModel & {
    decisions: (TradeDecisionModel & { position: PositionModel | null })[];
  })[];
};

export type PositionWithOrders = PositionModel & {
  orders: OrderModel[];
};

export type PositionWithEvents = PositionModel & {
  events: PositionEventModel[];
};

export type PositionFull = PositionModel & {
  orders: OrderModel[];
  events: PositionEventModel[];
  decisions: TradeDecisionModel[];
};

export type DecisionWithRelations = TradeDecisionModel & {
  thesis: ThesisModel | null;
  position: PositionModel | null;
  order: OrderModel | null;
};
