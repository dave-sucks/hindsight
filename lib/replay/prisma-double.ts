/**
 * prisma-double.ts — an in-memory stand-in for the database, so a test can
 * run a tool's REAL entry point (DAV-311).
 *
 * Why this exists. Four times now we have shipped a rule that could never
 * run, with a green test underneath it. The last one cost a feature: DAV-240
 * gave `checkWatchingOptOut` a RETIRED(SOLD) exemption, its unit test called
 * that helper directly and passed, and in production `checkStatusTransition`
 * returned at the terminal rule seven hundred lines earlier. SMMT was handed
 * to the run on 2026-09-23, refused twice, and the suite stayed green
 * throughout. #687, #688, #701 and DAV-308 are all the same shape.
 *
 * The cause is not carelessness, it is price. Testing `update_thesis`'s real
 * execute used to cost about forty-five lines of `jest.mock` — prisma, the
 * quote vendor, the audit writer, the trigger cascade — so the cheap thing
 * was to test a pure helper instead, and the cheap thing is what got done.
 * This makes the real path the cheap one.
 *
 * ── Two rules this double lives by ────────────────────────────────────────
 *
 * **Double the edges, never the logic.** The database, the vendors and the
 * clock are doubled. `checkStatusTransition`, `resolveThesisLadder`,
 * `applyTriggerOps`, `writeThesisUpdate`, plan-sanity — every one of those
 * runs for real against this store. Mock one of them and you are back to
 * proving a stub.
 *
 * **Never guess.** A query shape this engine does not understand THROWS,
 * naming the shape. It never falls through to `[]` or `null`. A double that
 * quietly answers "no rows" to a filter it could not read is the same
 * disease one layer down: green underneath, wrong on top.
 *
 * ── What it is not ────────────────────────────────────────────────────────
 *
 * Not a Prisma reimplementation. It handles the query shapes the agent tools
 * actually issue, and rows carry their relations inline (see rows.ts) rather
 * than being joined here — so `select` is a projection over a row that is
 * already the joined shape.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One stored row. Relations are nested objects on the row itself. */
export type Row = Record<string, unknown>;

/** Rows to put in the database before the tool runs, keyed by Prisma model. */
export type StoreSeed = Partial<Record<string, Row[]>>;

type ModelName = string;

/**
 * Every model, read from the real schema — so a tool that touches a table
 * nobody has replayed before needs no edit here, and a typo'd model name
 * still throws instead of quietly becoming an empty table.
 */
function schemaModels(): string[] {
  const schema = readFileSync(
    join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  return [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(
    (m) => m[1].charAt(0).toLowerCase() + m[1].slice(1),
  );
}

const MODELS: ModelName[] = schemaModels();

function unsupported(what: string, value: unknown): never {
  throw new Error(
    `[prisma-double] unsupported ${what}: ${JSON.stringify(value)}\n` +
      `This double refuses to guess. Add the shape to lib/replay/prisma-double.ts ` +
      `— returning an empty result here would hide exactly the bug the replay harness exists to catch.`,
  );
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

/** Prisma compares Dates by value; everything else by ===. */
function sameScalar(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Date && typeof b === "string") return a.toISOString() === b;
  return a === b;
}

function cmp(a: unknown, b: unknown): number {
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  if (typeof av === "number" && typeof bv === "number") return av - bv;
  if (typeof av === "string" && typeof bv === "string") return av < bv ? -1 : av > bv ? 1 : 0;
  return unsupported("comparison between", [a, b]);
}

/** One field's filter: a scalar, or an operator object Prisma understands. */
function matchField(actual: unknown, expected: unknown): boolean {
  if (!isPlainObject(expected)) return sameScalar(actual, expected);

  // A JSON-column path filter: `{ path: ["ticker"], equals: "CYTK" }`. Real
  // shape, used by the dispatch in-flight gate against ResearchRun.parameters.
  if (Array.isArray((expected as Record<string, unknown>).path)) {
    const { path, ...rest } = expected as { path: string[] } & Record<string, unknown>;
    let at: unknown = actual;
    for (const seg of path) {
      if (!isPlainObject(at)) return false;
      at = at[seg];
    }
    return matchField(at, rest);
  }

  // A nested relation filter — rows carry relations inline, so recurse.
  const opKeys = ["equals", "in", "notIn", "not", "gt", "gte", "lt", "lte", "contains", "startsWith", "mode"];
  const keys = Object.keys(expected);
  const isOperator = keys.some((k) => opKeys.includes(k));
  if (!isOperator) {
    if (actual == null) return false;
    if (!isPlainObject(actual)) return unsupported("relation filter against non-object", actual);
    return matchWhere(actual, expected);
  }

  for (const [op, v] of Object.entries(expected)) {
    switch (op) {
      case "mode":
        break; // case-insensitivity is a vendor concern, not a logic one
      case "equals":
        if (!sameScalar(actual, v)) return false;
        break;
      case "in":
        if (!Array.isArray(v) || !v.some((x) => sameScalar(actual, x))) return false;
        break;
      case "notIn":
        if (Array.isArray(v) && v.some((x) => sameScalar(actual, x))) return false;
        break;
      case "not":
        if (isPlainObject(v)) {
          if (matchField(actual, v)) return false;
        } else if (sameScalar(actual, v)) return false;
        break;
      case "gt":
        if (actual == null || cmp(actual, v) <= 0) return false;
        break;
      case "gte":
        if (actual == null || cmp(actual, v) < 0) return false;
        break;
      case "lt":
        if (actual == null || cmp(actual, v) >= 0) return false;
        break;
      case "lte":
        if (actual == null || cmp(actual, v) > 0) return false;
        break;
      case "contains":
        if (typeof actual !== "string" || typeof v !== "string") return false;
        if (!actual.toLowerCase().includes(v.toLowerCase())) return false;
        break;
      case "startsWith":
        if (typeof actual !== "string" || typeof v !== "string") return false;
        if (!actual.toLowerCase().startsWith(v.toLowerCase())) return false;
        break;
      default:
        return unsupported("where operator", { [op]: v });
    }
  }
  return true;
}

export function matchWhere(row: Row, where: unknown): boolean {
  if (where == null) return true;
  if (!isPlainObject(where)) return unsupported("where clause", where);
  for (const [key, expected] of Object.entries(where)) {
    if (expected === undefined) continue;
    if (key === "AND") {
      const list = Array.isArray(expected) ? expected : [expected];
      if (!list.every((w) => matchWhere(row, w))) return false;
    } else if (key === "OR") {
      const list = Array.isArray(expected) ? expected : [expected];
      if (!list.some((w) => matchWhere(row, w))) return false;
    } else if (key === "NOT") {
      const list = Array.isArray(expected) ? expected : [expected];
      if (list.some((w) => matchWhere(row, w))) return false;
    } else if (key === "some" || key === "none" || key === "every") {
      return unsupported("list-relation filter", { [key]: expected });
    } else if (!matchField(row[key], expected)) {
      return false;
    }
  }
  return true;
}

function orderRows(rows: Row[], orderBy: unknown): Row[] {
  if (orderBy == null) return rows;
  const clauses = (Array.isArray(orderBy) ? orderBy : [orderBy]) as Record<string, unknown>[];
  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      for (const [field, dir] of Object.entries(clause)) {
        if (dir !== "asc" && dir !== "desc") return unsupported("orderBy direction", { [field]: dir });
        const av = a[field];
        const bv = b[field];
        if (av == null && bv == null) continue;
        if (av == null) return dir === "asc" ? -1 : 1;
        if (bv == null) return dir === "asc" ? 1 : -1;
        const c = cmp(av, bv);
        if (c !== 0) return dir === "asc" ? c : -c;
      }
    }
    return 0;
  });
}

/**
 * Project a row through `select` / `include`. A nested object is either a
 * relation already on the row (projected recursively) or, for a list
 * relation, filtered and ordered like a findMany.
 */
function project(row: Row, select: unknown, include: unknown): Row {
  if (include != null && isPlainObject(include)) {
    const out: Row = { ...row };
    for (const [key, spec] of Object.entries(include)) {
      if (spec === false || spec === undefined) continue;
      out[key] = projectRelation(row[key], spec);
    }
    return out;
  }
  if (select == null || !isPlainObject(select)) return { ...row };
  const out: Row = {};
  for (const [key, spec] of Object.entries(select)) {
    if (spec === false || spec === undefined) continue;
    if (spec === true) {
      out[key] = row[key] ?? null;
    } else {
      out[key] = projectRelation(row[key], spec);
    }
  }
  return out;
}

function projectRelation(value: unknown, spec: unknown): unknown {
  const s = isPlainObject(spec) ? spec : {};
  if (Array.isArray(value)) {
    let rows = value as Row[];
    if (s.where != null) rows = rows.filter((r) => matchWhere(r, s.where));
    if (s.orderBy != null) rows = orderRows(rows, s.orderBy);
    if (typeof s.take === "number") rows = rows.slice(0, s.take);
    return rows.map((r) => project(r, s.select, s.include));
  }
  if (value == null) return null;
  if (isPlainObject(value)) return project(value, s.select, s.include);
  return value;
}

export interface PrismaDouble {
  /** Every model's rows, live — assert against this after a replay. */
  readonly store: Record<ModelName, Row[]>;
  /** Every call the tool made, in order: "thesis.findUnique", … */
  readonly calls: string[];
  [model: string]: unknown;
}

/**
 * Build the double. Seeded rows are stored by reference-free copy so a
 * mutation inside the tool shows up in `store` but not in the caller's
 * fixture.
 */
export function prismaDouble(seed: StoreSeed = {}): PrismaDouble {
  for (const name of Object.keys(seed)) {
    if (!MODELS.includes(name)) {
      throw new Error(
        `[prisma-double] seeded unknown model "${name}". Prisma models are camelCase ` +
          `(thesisUpdate, not ThesisUpdate or thesis_update).`,
      );
    }
  }
  const store = Object.fromEntries(
    MODELS.map((m) => [m, (seed[m] ?? []).map((r) => ({ ...r }))]),
  ) as Record<ModelName, Row[]>;
  const calls: string[] = [];

  const model = (name: ModelName) => {
    const rows = () => store[name];
    const note = (op: string) => calls.push(`${name}.${op}`);
    return {
      findUnique: async (a: Record<string, unknown> = {}) => {
        note("findUnique");
        const hit = rows().find((r) => matchWhere(r, a.where));
        return hit ? project(hit, a.select, a.include) : null;
      },
      findFirst: async (a: Record<string, unknown> = {}) => {
        note("findFirst");
        const hit = orderRows(rows().filter((r) => matchWhere(r, a.where)), a.orderBy)[0];
        return hit ? project(hit, a.select, a.include) : null;
      },
      findMany: async (a: Record<string, unknown> = {}) => {
        note("findMany");
        let out = rows().filter((r) => matchWhere(r, a.where));
        out = orderRows(out, a.orderBy);
        if (a.distinct != null) {
          const fields = Array.isArray(a.distinct) ? a.distinct : [a.distinct];
          const seen = new Set<string>();
          out = out.filter((r) => {
            const k = (fields as string[]).map((f) => String(r[f])).join("\u0000");
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
        }
        if (typeof a.skip === "number") out = out.slice(a.skip);
        if (typeof a.take === "number") out = out.slice(0, a.take);
        return out.map((r) => project(r, a.select, a.include));
      },
      count: async (a: Record<string, unknown> = {}) => {
        note("count");
        return rows().filter((r) => matchWhere(r, a.where)).length;
      },
      create: async (a: Record<string, unknown> = {}) => {
        note("create");
        const data = { ...(a.data as Row) };
        if (data.id == null) data.id = `${name}_${rows().length + 1}`;
        rows().push(data);
        return project(data, a.select, a.include);
      },
      update: async (a: Record<string, unknown> = {}) => {
        note("update");
        const hit = rows().find((r) => matchWhere(r, a.where));
        if (!hit) throw new Error(`[prisma-double] ${name}.update matched no row: ${JSON.stringify(a.where)}`);
        Object.assign(hit, a.data as Row);
        return project(hit, a.select, a.include);
      },
      updateMany: async (a: Record<string, unknown> = {}) => {
        note("updateMany");
        const hits = rows().filter((r) => matchWhere(r, a.where));
        for (const h of hits) Object.assign(h, a.data as Row);
        return { count: hits.length };
      },
      delete: async (a: Record<string, unknown> = {}) => {
        note("delete");
        const i = rows().findIndex((r) => matchWhere(r, a.where));
        if (i < 0) throw new Error(`[prisma-double] ${name}.delete matched no row`);
        return rows().splice(i, 1)[0];
      },
      deleteMany: async (a: Record<string, unknown> = {}) => {
        note("deleteMany");
        const keep = rows().filter((r) => !matchWhere(r, a.where));
        const n = rows().length - keep.length;
        store[name] = keep;
        return { count: n };
      },
      upsert: async (a: Record<string, unknown> = {}) => {
        note("upsert");
        const hit = rows().find((r) => matchWhere(r, a.where));
        if (hit) {
          Object.assign(hit, a.update as Row);
          return project(hit, a.select, a.include);
        }
        const data = { ...(a.create as Row) };
        if (data.id == null) data.id = `${name}_${rows().length + 1}`;
        rows().push(data);
        return project(data, a.select, a.include);
      },
    };
  };

  const db: Record<string, unknown> = { store, calls };
  for (const m of MODELS) db[m] = model(m);
  // Tools that wrap writes in a transaction get the same client back, so the
  // writes land in the same store and are visible to later assertions.
  db.$transaction = async (arg: unknown) =>
    typeof arg === "function"
      ? await (arg as (tx: unknown) => Promise<unknown>)(db)
      : await Promise.all(arg as Promise<unknown>[]);
  db.$executeRawUnsafe = async () => 0;
  db.$executeRaw = async () => 0;
  db.$queryRawUnsafe = async () => [];
  db.$queryRaw = async () => [];

  return db as unknown as PrismaDouble;
}
