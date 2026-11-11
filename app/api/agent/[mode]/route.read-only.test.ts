/**
 * The Portfolio Reviewer's run takes no messages. Its page showed a live
 * composer, and a message typed there reached this route as a research run
 * with no analyst and the full trade tools on the LIVE book. The page now
 * has no composer (READ_ONLY_RUN_MODES in lib/runs/modes.ts), and the route
 * refuses a message on such a run however it is sent.
 */
const runRow = { environment: "LIVE", agentConfigId: null as string | null, mode: "PORTFOLIO_REVIEW" };
const resolveCreds = jest.fn(async () => null);

jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "user_owner" } } }) } }) }));
jest.mock("@/lib/auth/account", () => ({ getAccountId: async () => "account_live", getUserRole: async () => "OWNER" }));
jest.mock("@/lib/prisma", () => ({ prisma: { researchRun: { findFirst: async () => runRow } } }));
jest.mock("@/lib/actions/api-keys.actions", () => ({ resolveAlpacaCredentials: (...a: unknown[]) => resolveCreds(...(a as [])) }));

import { POST } from "./route";
import { READ_ONLY_RUN_MODES } from "@/lib/runs/modes";

const send = (body: Record<string, unknown>) =>
  POST(new Request("http://localhost/api/agent/research-run", { method: "POST", body: JSON.stringify(body) }) as never, { params: Promise.resolve({ mode: "research-run" }) });

describe("a message on the Portfolio Reviewer's run", () => {
  it("is refused before anything is loaded: no broker keys, no tools", async () => {
    const res = await send({ runId: "run_review", messages: [{ role: "user", parts: [{ type: "text", text: "Sell MU." }] }] });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("This run takes no messages");
    expect(resolveCreds).not.toHaveBeenCalled();
  });

  it("the run mode is in the one read-only set the page and the route both read", () => {
    expect(READ_ONLY_RUN_MODES.has("PORTFOLIO_REVIEW")).toBe(true);
    expect(READ_ONLY_RUN_MODES.has("MORNING_PLAN")).toBe(false);
  });
});
