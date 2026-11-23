/**
 * When the morning's runs start, read off the jobs as they register.
 *
 * Mon Nov 23 2026: the 8:00 run judged NVDA at Friday's $125.53 and PLTR at
 * $143.49, because before 9:30 the app serves the last close. By 9:35 PLTR was
 * $158.39, and Nvidia's filing that morning waited for Wednesday's run.
 */
import { isInsideMorningBatch } from "@/lib/email-suppression";
import { SCHEDULE } from "@/lib/agent/engine/schedule";

type Trigger = { cron?: string };
type Fn = { trigger: Trigger | Trigger[] };

async function registered(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/prisma", () => ({ prisma: {} }));
    jest.doMock("@/lib/inngest/client", () => ({
      inngest: { createFunction: (_c: unknown, trigger: unknown, handler: unknown) => ({ trigger, handler }), send: jest.fn() },
    }));
    const { morningResearch } = (await import("./morning-research")) as unknown as { morningResearch: Fn };
    const { marketReviewer } = (await import("./market-reviewer")) as unknown as { marketReviewer: Fn };
    const { dailyRunDigest } = (await import("./daily-run-digest")) as unknown as { dailyRunDigest: Fn };
    const cron = (f: Fn) => [f.trigger].flat().find((t) => t.cron)!.cron!;
    out.reviewer = cron(marketReviewer);
    out.morning = cron(morningResearch);
    out.digest = cron(dailyRunDigest);
  });
  for (const m of ["@/lib/prisma", "@/lib/inngest/client"]) jest.dontMock(m);
  return out;
}

const clock = (cron: string) => {
  const [minute, hour] = cron.replace(/^TZ=\S+\s+/, "").split(/\s+/).map(Number);
  return hour * 60 + minute;
};
const OPEN = 9 * 60 + 30;

describe("the morning's run times", () => {
  it("reads the news before the open, decides after it, and emails after the runs", async () => {
    const t = await registered();
    const manager = SCHEDULE.find((s) => s.agent === "portfolio_manager")!;
    expect(clock(t.reviewer)).toBeLessThan(OPEN);
    expect(clock(t.morning)).toBe(OPEN + 30);
    expect(clock(manager.cron)).toBeGreaterThan(clock(t.morning));
    expect(clock(t.digest)).toBeGreaterThan(clock(t.morning));
    for (const c of [t.reviewer, t.morning, t.digest]) expect(c.startsWith("TZ=America/New_York ")).toBe(true);
  });
});

describe("a morning run's trade waits for the 11:00 email", () => {
  const at = (iso: string, mode = "MORNING_PLAN") => isInsideMorningBatch(mode, new Date(iso));

  it("folds in the 10:00 run, and a Run pressed earlier that morning", () => {
    expect(at("2026-11-23T15:04:00Z")).toBe(true); // Mon 10:04 ET
    expect(at("2026-11-23T15:58:00Z")).toBe(true); // Mon 10:58 ET
    expect(at("2026-11-23T13:01:00Z")).toBe(true); // Mon 8:01 ET
  });

  it("emails at once after the digest has gone, on a weekend, or from a trigger run", () => {
    expect(at("2026-11-23T16:01:00Z")).toBe(false); // Mon 11:01 ET
    expect(at("2026-11-21T15:04:00Z")).toBe(false); // Sat 10:04 ET
    expect(at("2026-11-23T15:04:00Z", "INTRADAY_TACTICAL")).toBe(false);
  });
});
