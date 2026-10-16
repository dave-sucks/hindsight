/**
 * The live book at 13:36 ET on 2026-10-16: the account's 12 open positions, the
 * triggers in force on each (thesis, analyst, account) and the prices read then.
 * Read from production, read-only. Notes are left out, and so are the triggers
 * that read earnings, filings or the chart, which these replays never feed.
 */
import type { Trigger } from "@/lib/agent/triggers/types";

type Pred = Trigger["predicate"];
const px = (is: string, value: number, close?: boolean) => ({ watch: "price", is, value, ...(close ? { settings: { close: true } } : {}) }) as Pred;
const mv = (is: string, value: number, variable: string, settings?: Record<string, number>) => ({ watch: "move", is, value, variable, ...(settings ? { settings } : {}) }) as Pred;
const rep = (value: number) => ({ watch: "repeat", value }) as Pred;
const fd = (is: string, value: number, variable: string) => ({ watch: "from_date", is, value, variable }) as Pred;
const t = (id: string, action: Trigger["action"], predicate: Pred, cooldownDays?: number, fireMode?: "TACTICAL" | "DIRECT", lastFiredAt?: string): Trigger =>
  ({ id, action, predicate, rationale: "-", ...(cooldownDays != null ? { cooldownDays } : {}), ...(fireMode ? { fireMode } : {}), ...(lastFiredAt ? { lastFiredAt } : {}) });

export const AT = new Date("2026-10-16T17:36:15.000Z");
export const ACCOUNT_ID = "34f5c589-e216-4afe-9ee8-613c13f300e7";
export const PEAD = "cmnhxpjio000004jvox6kl6c7";
export const CATALYST = "cmmmh0wxu000004js7yoyzvlf";
export const SECULAR = "cmmqxola3000004lbj7c11bfn";

export const ACCOUNT_TRIGGERS: Trigger[] = [
  t("1aba586f", "ADD", mv("above", 7, "prev_close"), 3, "TACTICAL"),
  t("b459cc93", "REVIEW", rep(7), 7, "TACTICAL"),
];
export const ANALYST_TRIGGERS: Record<string, Trigger[]> = {
  [PEAD]: [
    t("f552414c", "EXIT", mv("below", 12, "peak", {startOnceUpPct: 10}), 0, "TACTICAL"),
    t("8d64ad2b", "REVIEW", mv("above", 10, "entry"), 7),
    t("56be49ac", "REVIEW", mv("below", 12, "entry"), 7),
  ],
  [CATALYST]: [
    t("859afdef", "REVIEW", fd("before", 10, "event"), 10),
    t("18d100c3", "REVIEW", fd("after", 30, "event"), 30),
  ],
  [SECULAR]: [
    t("06506e39", "REVIEW", mv("below", 15, "peak"), 7),
    t("823a7df5", "EXIT", mv("below", 25, "peak"), 0),
    t("a6d188ee", "REVIEW", mv("above", 15, "entry"), 7),
    t("98f6fe80", "REVIEW", mv("below", 15, "entry"), 7),
    t("ef79457a", "ADD", mv("below", 7, "prev_close"), 1),
  ],
};

/** One holding: its thesis and position rows, the 13:36 quote and the 10-15 close. */
const stock = (ticker: string, analystId: string, thesisId: string, positionId: string, quantity: number, avgCost: number, peakPrice: number, openedAt: string, stopLoss: number, price: number, prevClose: number, lastReviewedAt: string, triggers: Trigger[], triggerState: Record<string, { firedAt: string }> = {}, catalystDate: string | null = null) =>
  ({ ticker, analystId, thesisId, positionId, quantity, avgCost, peakPrice, openedAt, stopLoss, price, prevClose, lastReviewedAt, triggers, triggerState, catalystDate });
export type BookStock = ReturnType<typeof stock>;

export const BOOK: BookStock[] = [
  stock("AAPL", SECULAR, "cmum3bxkt000204l243g6s93c", "cmur1j0qr000804lezxpxmyvf", 29, 333.565, 345.7, "2026-10-02T17:31:48Z", 309, 343.43, 342, "2026-10-02T14:10:39Z", [
    t("bb542f17", "REVIEW", fd("after", 60, "buy"), 60),
    t("9e52bd61", "REVIEW", mv("below", 15, "peak", {startOnceUpPct: 20}), 1),
    t("042b5be4", "EXIT", px("below", 309), 1),
    t("8b75f797", "REVIEW", px("above", 383), 1),
    t("6570f5fa", "REVIEW", rep(30), 30),
    t("23f17d28", "REVIEW", px("below", 307.14), 1),
  ]),
  stock("ASML", SECULAR, "cmqooyvy8000004l5a9njg6n5", "cmtn0hpa6000304juujs868k7", 5, 1716.09, 1871.1, "2026-09-04T14:23:33Z", 1835, 1660.26, 1657.44, "2026-10-15T18:25:27Z", [
    t("8a973603", "REVIEW", rep(30), 30),
    t("db24f4bd", "REVIEW", px("below", 1573.6), 1),
    t("crepair0904-asml-target", "REVIEW", px("above", 2800), 1),
    t("f53e243d", "REVIEW", fd("after", 60, "buy"), 60),
    t("8e790d37", "EXIT", px("below", 1835), 1, "TACTICAL", "2026-10-15T18:25:06Z"),
  ]),
  stock("CEG", SECULAR, "cmqb2ku1a000q04l6jtquuqr6", "cmsrk43d7000604jxyc6s7u4r", 51, 282.006094117647, 308.075, "2026-08-13T14:26:27Z", 248, 272.13, 275, "2026-10-16T14:30:47Z", [
    t("cafcc57b", "EXIT", px("below", 287.3), 0, "TACTICAL"),
    t("a2fa9578", "REVIEW", px("below", 256.42), 1, "TACTICAL", "2026-10-02T13:40:15Z"),
    t("9dde5606", "REVIEW", px("above", 360), 1),
    t("0cec3fcf", "REVIEW", rep(30), 30, "TACTICAL"),
    t("5cf4c100", "REVIEW", fd("after", 60, "buy"), 60, undefined, "2026-10-12T14:30:25Z"),
  ], {"06506e39": { firedAt:"2026-09-28T15:20:10Z" },"1aba586f": { firedAt:"2026-10-06T13:30:13Z" },"cacf717e": { firedAt:"2026-09-14T19:30:15Z" },"cf39ff35": { firedAt:"2026-10-14T13:55:01Z" }}),
  stock("CORT", CATALYST, "cmuhp4n4e000e04kx3vkxm5lr", "cmumrx45e000204kzra9s0ows", 43, 116.0313, 122.3, "2026-09-30T13:35:37Z", 108.4, 108.69, 113.37, "2026-10-16T17:00:58Z", [
    t("8d4c8654", "REVIEW", px("below", 108.1, true), 1),
    t("cc036f1a", "REVIEW", rep(21), 21),
    t("d515ba10", "REVIEW", fd("before", 14, "event"), 14),
    t("6a51d02a", "EXIT", px("below", 108.4), 1, undefined, "2026-10-16T17:00:16Z"),
    t("86a09dc3", "REVIEW", px("above", 152), 1),
  ], {}, "2026-12-17T00:00:00Z"),
  stock("GEV", SECULAR, "cmqb2nt4b001r04k0ahd3crrx", "cmupqqaxh000c04l7veionptx", 9, 984.585, 1050.33, "2026-10-01T16:59:56Z", 868, 932, 926.44, "2026-10-16T12:04:11Z", [
    t("ae04d898", "REVIEW", px("below", 850), 1, "TACTICAL"),
    t("2a43b1a0", "REVIEW", rep(30), 30, "TACTICAL"),
    t("8861139d", "EXIT", px("below", 868), 1),
    t("ddb989a6", "REVIEW", px("above", 1300), 1),
    t("6cc9e2c7", "REVIEW", fd("after", 60, "buy"), 60),
  ], {"06506e39": { firedAt:"2026-10-15T13:50:14Z" },"cacf717e": { firedAt:"2026-08-18T18:05:20Z" },"cf39ff35": { firedAt:"2026-10-14T18:10:09Z" },"ef79457a": { firedAt:"2026-10-14T15:25:02Z" }}),
  stock("IOT", PEAD, "cmu062bge000004jtd1aqp304", "cmv9m90g0000a06l3zv45o24s", 300, 42.695, 42.57, "2026-10-15T15:16:02Z", 41.42, 39.4, 42.59, "2026-10-16T12:01:11Z", [
    t("8fc79e5c", "REVIEW", rep(7), 7),
    t("15f0e46f", "REVIEW", fd("after", 60, "buy"), 60),
    t("cf1e7fd0", "EXIT", px("below", 41.42), 0, "DIRECT"),
    t("498b57b9", "REVIEW", px("above", 47), 1),
  ], {"1aba586f": { firedAt:"2026-09-14T15:35:07Z" },"8d64ad2b": { firedAt:"2026-10-05T13:35:09Z" }}),
  stock("MSFT", SECULAR, "cmoh5nfsg008m04jubqafc6c6", "cmuvp2d66000704jx65yspjo4", 17, 531.0146, 549.4125, "2026-10-06T19:39:30Z", 486, 527.34, 539.44, "2026-10-09T12:03:03Z", [
    t("782fceab", "REVIEW", rep(30), 7, "TACTICAL"),
    t("65fe98f7", "REVIEW", mv("above", 7, "prev_close"), 1, "TACTICAL"),
    t("abc35ceb", "REVIEW", mv("below", 7, "prev_close"), 1, "TACTICAL"),
    t("3392956b", "EXIT", px("below", 486), 1),
    t("e2bb68e9", "REVIEW", px("above", 600), 1),
    t("5f2eaaa9", "REVIEW", px("below", 483.17), 1),
    t("fc988907", "REVIEW", fd("after", 60, "buy"), 60),
  ]),
  stock("MU", SECULAR, "cmv9nm3xo000o06l3om8r7ath", "cmv9o0nhe000006lbmypszfe7", 11, 911.415, 916.73, "2026-10-15T15:06:54Z", 850, 894.91, 931.24, "2026-10-15T15:02:01Z", [
    t("d9b6bc8d", "REVIEW", px("below", 878), 1),
    t("ba421f37", "EXIT", px("below", 850), 1),
    t("bb928325", "REVIEW", px("above", 1500), 1),
    t("445048fe", "REVIEW", rep(30), 30),
    t("978117be", "REVIEW", fd("after", 14, "buy"), 14),
  ]),
  stock("NVDA", PEAD, "cmtg9nbdy000204jpc6cwawgg", "cmtha1mcg000804kyrns3lpjg", 33, 218.2259, 242.505, "2026-08-31T13:53:39Z", 236, 215.68, 217.23, "2026-10-15T18:30:53Z", [
    t("d9c8dabf", "REVIEW", rep(7), 7),
    t("6306936b", "EXIT", px("below", 236), 0, "TACTICAL"),
    t("1f2454ae", "REVIEW", fd("after", 60, "buy"), 60),
    t("ff683e3b", "REVIEW", px("above", 243.37), 1),
  ], {"1758189f": { firedAt:"2026-09-14T19:55:09Z" },"8d64ad2b": { firedAt:"2026-10-06T13:30:13Z" },"f552414c": { firedAt:"2026-10-15T13:55:04Z" }}),
  stock("PLTR", SECULAR, "cmqop233h000n04l57odbcpup", "cmur09ux8000004kwtc96y54i", 38, 192.0105, 210.25, "2026-10-02T13:41:40Z", 164.55, 186.09, 200.5, "2026-10-16T17:05:35Z", [
    t("0bbee784", "REVIEW", px("below", 150), 1),
    t("1aba586f", "ADD", mv("above", 10, "prev_close"), 1),
    t("21976408", "EXIT", px("below", 196), 1, "TACTICAL", "2026-10-16T13:50:10Z"),
    t("390068f9", "REVIEW", px("above", 249.26), 1),
    t("4d8d094c", "REVIEW", rep(30), 30),
    t("2a99a333", "REVIEW", fd("after", 60, "buy"), 60),
  ], {"1aba586f": { firedAt:"2026-09-03T13:55:08Z" },"cacf717e": { firedAt:"2026-09-02T15:50:20Z" },"ef79457a": { firedAt:"2026-10-16T17:05:06Z" }}),
  stock("V", SECULAR, "cmum3c2la000704l2nq4rgf8k", "cmuvl5233000204jp3njifila", 27, 369.2526, 404.08, "2026-10-05T18:55:56Z", 344, 401.63, 399.75, "2026-10-16T12:05:12Z", [
    t("cf42e448", "REVIEW", mv("above", 4.6, "entry", {fastWinnerPct: 10}), 7, undefined, "2026-10-09T19:45:16Z"),
    t("5568fb17", "REVIEW", fd("after", 60, "buy"), 60),
    t("84f59b07", "EXIT", px("below", 365.5), 1),
    t("203c3f47", "REVIEW", px("above", 434), 1),
    t("a1d1220f", "REVIEW", rep(30), 30),
    t("a04e5161", "REVIEW", px("below", 339.39), 1),
  ]),
  stock("WST", SECULAR, "cmsplcu9u000004l71leub93x", "cmt1h3x8p001604jlbxnkzwpb", 20, 355.28, 385.835, "2026-08-20T19:55:54Z", 330, 381.44, 383.02, "2026-09-21T12:09:10Z", [
    t("8dbdc1a0", "EXIT", px("below", 330), 0, "TACTICAL"),
    t("883b2a20", "REVIEW", px("below", 324.57), 1, "TACTICAL"),
    t("e297695f", "REVIEW", px("above", 425), 1),
    t("14361c4f", "REVIEW", rep(30), 30, "TACTICAL"),
    t("566a9085", "REVIEW", fd("after", 60, "buy"), 60),
  ]),
];
