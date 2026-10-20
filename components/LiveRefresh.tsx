"use client";

import { useLiveRefresh } from "@/hooks/useLivePoll";

/** Drop into a server page to keep its prices current while it's on screen. */
export function LiveRefresh() {
  useLiveRefresh();
  return null;
}
