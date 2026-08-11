import { parseToolError, toolErrorDetailJson } from "./tool-error";

// The verbatim errorText from the 2026-08-09 principal-chat XENE failure —
// the case this module exists for. Note the rationale prose contains commas,
// a dollar sign and a hyphen, and the whole input is inlined before the issues.
const XENE_INVALID_INPUT =
  'Invalid input for tool close_position: Type validation failed: Value: ' +
  '{"ticker":"XENE","reason":"THESIS_INVALIDATED","notes":"Displacing XENE on a ' +
  "structural thesis violation, not a price call. The mandate requires a dated " +
  "catalyst event as a hard entry gate — there is no confirmed NDA submission date " +
  'on record."}. Error message: [ { "code": "invalid_value", "values": [ "TARGET", ' +
  '"STOP", "MANUAL" ], "path": [ "reason" ], "message": "Invalid option: expected ' +
  'one of \\"TARGET\\"|\\"STOP\\"|\\"MANUAL\\"" } ]';

describe("parseToolError", () => {
  describe("Zod input validation", () => {
    it("extracts the offending path and the legal values", () => {
      const parsed = parseToolError(XENE_INVALID_INPUT, "close_position");

      expect(parsed.kind).toBe("invalid_input");
      expect(parsed.title).toBe("Invalid input");
      expect(parsed.issues).toHaveLength(1);
      expect(parsed.issues[0].path).toBe("reason");
      expect(parsed.issues[0].expected).toEqual(["TARGET", "STOP", "MANUAL"]);
    });

    it("builds a one-line detail a human can act on", () => {
      const { detail } = parseToolError(XENE_INVALID_INPUT, "close_position");
      expect(detail).toBe("reason — expected TARGET, STOP or MANUAL");
    });

    it("recovers the input the model actually sent", () => {
      const { input } = parseToolError(XENE_INVALID_INPUT, "close_position");
      expect(input).toMatchObject({ ticker: "XENE", reason: "THESIS_INVALIDATED" });
    });

    it("does not stop the brace scan at a brace inside a string", () => {
      const withBraces =
        'Invalid input for tool update_thesis: Type validation failed: Value: ' +
        '{"ticker":"NVDA","notes":"the setup {broke} — see \\"note\\""}. ' +
        'Error message: [ { "path": [ "confidence" ], "message": "Required" } ]';
      const parsed = parseToolError(withBraces, "update_thesis");

      expect(parsed.input).toMatchObject({ ticker: "NVDA" });
      expect(parsed.issues[0].path).toBe("confidence");
      expect(parsed.detail).toBe("confidence — Required");
    });

    it("counts sibling issues instead of listing them all", () => {
      const multi =
        "Invalid input for tool place_trade: Type validation failed: Value: {}. " +
        'Error message: [ { "path": [ "ticker" ], "message": "Required" }, ' +
        '{ "path": [ "notional" ], "message": "Required" } ]';
      expect(parseToolError(multi, "place_trade").detail).toBe(
        "ticker — Required (+1 more)",
      );
    });

    it("nests a deep path with dots", () => {
      const nested =
        "Invalid input for tool update_thesis: Type validation failed: Value: {}. " +
        'Error message: [ { "path": [ "triggers", 0, "predicate" ], "message": "Bad" } ]';
      expect(parseToolError(nested, "update_thesis").issues[0].path).toBe(
        "triggers.0.predicate",
      );
    });

    it("falls back to prose when the issues array will not parse", () => {
      const broken =
        "Invalid input for tool close_position: Type validation failed: Value: {oops";
      const parsed = parseToolError(broken, "close_position");

      expect(parsed.kind).toBe("invalid_input");
      expect(parsed.issues).toEqual([]);
      expect(parsed.detail).not.toContain("for tool close_position");
    });
  });

  describe("other failure kinds", () => {
    it("classifies an approval denial", () => {
      expect(parseToolError("Tool approval denied").kind).toBe("denied");
    });

    it("classifies an unavailable tool", () => {
      expect(parseToolError("No such tool: manage_watchlist").kind).toBe("not_found");
    });

    it("treats a thrown tool error as execution and keeps the message", () => {
      const parsed = parseToolError("Alpaca rejected the order: insufficient buying power", "place_trade");
      expect(parsed.kind).toBe("execution");
      expect(parsed.title).toBe("Failed");
      expect(parsed.detail).toBe("Alpaca rejected the order: insufficient buying power");
    });

    it("collapses whitespace and truncates a wall of text", () => {
      const { detail } = parseToolError(`${"x".repeat(500)}`, "place_trade");
      expect(detail.length).toBeLessThanOrEqual(140);
      expect(detail.endsWith("…")).toBe(true);
    });

    it("survives a non-string error", () => {
      expect(parseToolError(null).detail).toBe("Unknown error");
      expect(parseToolError({ nope: true }).kind).toBe("execution");
    });

    // On a NoSuchToolError the tool name is whatever the model emitted, so it
    // can carry regex metacharacters. Unescaped, these either throw on RegExp
    // construction or backtrack catastrophically.
    it("does not blow up on a hallucinated tool name with regex metacharacters", () => {
      expect(() => parseToolError("No such tool: foo(", "foo(")).not.toThrow();
      expect(() => parseToolError("boom", "(a+)+$")).not.toThrow();
    });

    it("still strips a well-formed tool name prefix", () => {
      expect(parseToolError("place_trade: Alpaca is down", "place_trade").detail).toBe(
        "Alpaca is down",
      );
    });
  });
});

describe("toolErrorDetailJson", () => {
  it("leads with the issue and drops the redundant prose", () => {
    const parsed = parseToolError(XENE_INVALID_INPUT, "close_position");
    const json = toolErrorDetailJson(parsed, "close_position");

    expect(Object.keys(json)).toEqual(["tool", "kind", "issues", "input"]);
    expect(json).not.toHaveProperty("message");
  });

  it("shows expected values instead of the prose that restates them", () => {
    const parsed = parseToolError(XENE_INVALID_INPUT, "close_position");
    const [issue] = toolErrorDetailJson(parsed, "close_position").issues as Array<
      Record<string, unknown>
    >;

    expect(issue).toEqual({ path: "reason", expected: ["TARGET", "STOP", "MANUAL"] });
  });

  it("keeps the prose when there are no expected values to show", () => {
    const missing =
      "Invalid input for tool place_trade: Type validation failed: Value: {}. " +
      'Error message: [ { "path": [ "ticker" ], "message": "Required" } ]';
    const [issue] = toolErrorDetailJson(
      parseToolError(missing, "place_trade"),
      "place_trade",
    ).issues as Array<Record<string, unknown>>;

    expect(issue).toEqual({ path: "ticker", message: "Required" });
  });

  it("truncates a paragraph-length rationale in the input echo", () => {
    const { input } = toolErrorDetailJson(
      parseToolError(XENE_INVALID_INPUT, "close_position"),
      "close_position",
    ) as { input: Record<string, string> };

    expect(input.ticker).toBe("XENE");
    expect(input.notes).toMatch(/… \(\d+ chars\)$/);
    expect(input.notes.length).toBeLessThan(200);
  });

  it("keeps the message when there is nothing structured to show", () => {
    const parsed = parseToolError("Alpaca timed out", "close_position");
    expect(toolErrorDetailJson(parsed, "close_position")).toHaveProperty(
      "message",
      "Alpaca timed out",
    );
  });

  it("truncates a multi-KB message so it cannot become a wall of pre", () => {
    const parsed = parseToolError("x".repeat(5000), "place_trade");
    const { message } = toolErrorDetailJson(parsed, "place_trade") as { message: string };

    expect(message.length).toBeLessThan(220);
    expect(message).toMatch(/… \(\d+ chars\)$/);
  });
});
