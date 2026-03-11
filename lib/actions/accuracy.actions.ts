"use server";

import { prisma } from "@/lib/prisma";

// Re-export pure stats utility so existing client imports keep working
export {
  getAccuracyStats,
  type AccuracyStats,
  type CalibrationBucket,
  type SignalAccuracy,
  type DirectionStats,
} from "@/lib/accuracy-stats";

/**
 * Fetch the most recent stored AccuracyReport for a user.
 */
export async function getLatestAccuracyReport(userId: string) {
  return prisma.accuracyReport.findFirst({
    where: { userId },
    orderBy: { weekStartDate: "desc" },
  });
}
