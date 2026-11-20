/**
 * A server action is an endpoint any browser can call with any arguments.
 *
 * So none may trust a user or account id it is handed, or hand back keys:
 * `resolveAlpacaCredentials(userId, book)`, which returns decrypted broker
 * keys, sat in a "use server" file until 2026-11-19, and so did the sale and
 * cancel functions that take "who clicked" as an argument.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "generated" || name.startsWith(".")) return [];
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
const isActionFile = (src: string) => /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/.test(src);
const actionFiles = ["lib", "app", "components"].flatMap(files).filter((f) => isActionFile(readFileSync(f, "utf8")));

/** Every exported function of every server-action file, with its parameter list. */
const actions = actionFiles.flatMap((file) =>
  [...readFileSync(file, "utf8").matchAll(/^export async function (\w+)\s*\(([^)]*)\)/gm)].map((m) => ({ file, name: m[1], params: m[2] })),
);

it("finds the app's server actions", () => {
  expect(actionFiles).toContain("lib/actions/trade.actions.ts");
  expect(actions.length).toBeGreaterThan(40);
});

it("the files that read keys or sell by argument are not server-action files", () => {
  expect(actionFiles).not.toContain("lib/actions/api-keys.actions.ts");
  expect(actionFiles).not.toContain("lib/actions/closeTrade.actions.ts");
});

it("no server action takes a user id, an account id or broker keys from its caller, or is a key reader", () => {
  const trusting = actions.filter((a) => /\b(userId|ownerUserId|accountId|creds|alpacaCreds)\b|Credentials/.test(a.params) || /^resolve\w*(Key|Credentials)/.test(a.name));
  expect(trusting.map((a) => `${a.file}: ${a.name}(${a.params.replace(/\s+/g, " ").trim()})`)).toEqual([]);
});
