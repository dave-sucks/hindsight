// Re-export Prisma-generated types for convenience
// Note: Prisma v7 generates types with a "Model" suffix (e.g. TradeModel, not Trade)
export type {
  ResearchRunModel as ResearchRun,
  ThesisModel as Thesis,
  TradeModel as Trade,
  TradeEventModel as TradeEvent,
  AgentConfigModel as AgentConfig,
  UserModel as User,
  WatchlistItemModel as WatchlistItem,
  // New trading layer
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

// ─── Legacy Trade types (kept for old UI code until Phase 2) ─────────────────
export type TradeStatus = "OPEN" | "CLOSED" | "CANCELLED";
export type TradeEventType =
  | "PLACED"
  | "PRICE_CHECK"
  | "NEAR_TARGET"
  | "CLOSED"
  | "EVALUATED";

// ─── New Position types ──────────────────────────────────────────────────────
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

// ─── Composite types ─────────────────────────────────────────────────────────

import type {
  ResearchRunModel,
  ThesisModel,
  TradeModel,
  TradeEventModel,
  PositionModel,
  OrderModel,
  PositionEventModel,
  TradeDecisionModel,
} from "@/lib/generated/prisma/models";

// Legacy composites (kept for old UI code until Phase 2)
export type ThesisWithTrade = ThesisModel & {
  trade: TradeModel | null;
};

export type TradeWithEvents = TradeModel & {
  events: TradeEventModel[];
};

export type ResearchRunWithTheses = ResearchRunModel & {
  theses: ThesisWithTrade[];
};

// New composites
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
