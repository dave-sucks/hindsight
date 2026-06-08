"use client";

import { useState } from "react";
import AppSidebar from "@/components/Sidebar";
import { OnboardingFlow, ProductTourDialog } from "@/components/domain/onboarding-flow";
import type { AlpacaEnvironment } from "@/lib/actions/api-keys.actions";

/**
 * Client wrapper that shares product-tour state between Sidebar and OnboardingFlow.
 * Rendered by the server layout so both can coordinate.
 */
export function OnboardingShell({
  user,
  initialStocks,
  portfolioValue,
  openTradeTickers,
  needsName,
  hasAlpacaKey,
  initialFullName,
  currentEnv,
  exposeLive,
}: {
  user: User;
  initialStocks: StockWithWatchlistStatus[];
  portfolioValue: number;
  openTradeTickers: string[];
  needsName: boolean;
  hasAlpacaKey: boolean;
  initialFullName: string;
  currentEnv: AlpacaEnvironment;
  exposeLive: boolean;
}) {
  const [showTour, setShowTour] = useState(false);

  return (
    <>
      <AppSidebar
        user={user}
        initialStocks={initialStocks}
        portfolioValue={portfolioValue}
        openTradeTickers={openTradeTickers}
        onProductTour={() => setShowTour(true)}
        currentEnv={currentEnv}
        exposeLive={exposeLive}
      />

      <OnboardingFlow
        needsName={needsName}
        hasAlpacaKey={hasAlpacaKey}
        initialFullName={initialFullName}
      />

      <ProductTourDialog
        open={showTour}
        onOpenChange={setShowTour}
      />
    </>
  );
}
