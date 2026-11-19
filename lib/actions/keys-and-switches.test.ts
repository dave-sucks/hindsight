/**
 * A saved key's address is its slot's own, and the approval save takes only
 * the four switches.
 *
 * Before this, the browser could send any address with a key (the Paper slot
 * could hold the Live one) and any column name with a switch.
 */
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner_1" } }, error: null }) } }) }));
jest.mock("@/lib/auth/account", () => ({ getAccountId: async () => "acct_1", getUserRole: async () => "OWNER", getOwnerUserId: async () => "owner_1" }));
jest.mock("@/lib/crypto", () => ({ encryptAndPack: (v: string) => `enc:${v}`, unpackAndDecrypt: (v: string) => v.replace("enc:", "") }));
jest.mock("@/lib/podcast/elevenlabs", () => ({ listVoices: async () => [] }));
jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
const mockGetAccount = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock("@/lib/alpaca", () => ({ getAccount: (...a: unknown[]) => mockGetAccount(...a) }));
const mockKeyRow = jest.fn();
const mockKeySave = jest.fn(async (..._a: unknown[]) => ({}));
const mockAccountUpdate = jest.fn(async (..._a: unknown[]) => ({ requireApprovalBuysLive: true, requireApprovalSellsLive: true, requireApprovalBuysPaper: false, requireApprovalSellsPaper: true }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    userApiKey: { findUnique: (...a: unknown[]) => mockKeyRow(...a), upsert: (...a: unknown[]) => mockKeySave(...a) },
    account: { update: (...a: unknown[]) => mockAccountUpdate(...a) },
  },
}));

import { resolveAlpacaCredentials, saveApiKey } from "@/lib/actions/api-keys.actions";
import { setAccountApprovalToggle } from "@/lib/actions/account-settings.actions";

const PAPER = "https://paper-api.alpaca.markets";
const LIVE = "https://api.alpaca.markets";
beforeEach(() => jest.clearAllMocks());

describe("a key's address is its slot's own", () => {
  it("production's two rows read back on their own addresses", async () => {
    mockKeyRow.mockResolvedValue({ encryptedKey: "enc:PK", encryptedSecret: "enc:s", baseUrl: null });
    expect((await resolveAlpacaCredentials("owner_1", "PAPER"))?.baseUrl).toBe(PAPER);
    mockKeyRow.mockResolvedValue({ encryptedKey: "enc:AK", encryptedSecret: "enc:s", baseUrl: LIVE });
    expect((await resolveAlpacaCredentials("owner_1", "LIVE"))?.baseUrl).toBe(LIVE);
  });

  it("a Paper row saved with the Live address still reads back on Paper", async () => {
    mockKeyRow.mockResolvedValue({ encryptedKey: "enc:PK", encryptedSecret: "enc:s", baseUrl: LIVE });
    expect((await resolveAlpacaCredentials("owner_1", "PAPER"))?.baseUrl).toBe(PAPER);
  });

  it("a browser that sends the Live address with a Paper key has it ignored: checked and stored on Paper", async () => {
    await saveApiKey({ provider: "ALPACA", environment: "PAPER", apiKey: "PK1234", apiSecret: "s", baseUrl: LIVE } as never);
    expect(mockGetAccount).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: PAPER }));
    expect(mockKeySave.mock.calls[0][0]).toMatchObject({ create: { environment: "PAPER", baseUrl: PAPER }, update: { baseUrl: PAPER } });
  });
});

describe("the approval save takes only the four switches", () => {
  it("turning Paper buys off writes that one column and no Live one", async () => {
    await setAccountApprovalToggle({ field: "requireApprovalBuysPaper", value: false });
    expect(mockAccountUpdate.mock.calls[0][0]).toMatchObject({ where: { id: "acct_1" }, data: { requireApprovalBuysPaper: false } });
    expect(Object.keys((mockAccountUpdate.mock.calls[0][0] as { data: object }).data)).toEqual(["requireApprovalBuysPaper"]);
  });

  it.each([
    ["another column", { field: "name", value: true }],
    ["an inherited name", { field: "constructor", value: true }],
    ["a value that is not true or false", { field: "requireApprovalBuysLive", value: "false" }],
  ])("%s is refused and nothing is written", async (_what, input) => {
    await expect(setAccountApprovalToggle(input as never)).rejects.toThrow("Unknown approval setting");
    expect(mockAccountUpdate).not.toHaveBeenCalled();
  });
});
