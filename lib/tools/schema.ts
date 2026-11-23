import type { JsonSchema, PropertySchema } from "./types";

/**
 * Checks the arguments the model sent against a tool's schema before the tool runs.
 *
 * Models do get arguments wrong — a missing field, a string where a number belongs,
 * an invented property. Catching it here turns a crash into a message the model can
 * read and retry, and stops unchecked values reaching the tool's code.
 *
 * Only the subset of JSON Schema in `JsonSchema` is supported; that is all our tools use.
 */
export function validateArgs(
  schema: JsonSchema,
  args: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, error: "Arguments must be a JSON object." };
  }

  const input = args as Record<string, unknown>;
  const value: Record<string, unknown> = {};

  for (const name of schema.required ?? []) {
    if (input[name] === undefined || input[name] === null) {
      return { ok: false, error: `Missing required argument "${name}".` };
    }
  }

  for (const [name, raw] of Object.entries(input)) {
    // Own properties only: a key like "constructor" or "__proto__" must not pick up
    // something inherited from Object.prototype and be treated as a declared property.
    const property = Object.hasOwn(schema.properties, name) ? schema.properties[name] : undefined;
    if (!property) {
      // Ignore extras rather than failing: the answer matters more than the model's tidiness.
      continue;
    }
    if (raw === undefined || raw === null) continue;

    const checked = checkValue(name, property, raw);
    if ("error" in checked) return { ok: false, error: checked.error };
    value[name] = checked.value;
  }

  return { ok: true, value };
}

function checkValue(
  name: string,
  property: PropertySchema,
  raw: unknown,
): { value: unknown } | { error: string } {
  switch (property.type) {
    case "string": {
      if (typeof raw !== "string") return { error: `"${name}" must be a string.` };
      if (property.enum && !property.enum.includes(raw)) {
        return { error: `"${name}" must be one of: ${property.enum.join(", ")}.` };
      }
      if (property.maxLength && raw.length > property.maxLength) {
        return { error: `"${name}" must be ${property.maxLength} characters or fewer.` };
      }
      return { value: raw };
    }

    case "number":
    case "integer": {
      // Models sometimes send numbers as strings; accept that instead of failing the call.
      const num = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof num !== "number" || !Number.isFinite(num)) {
        return { error: `"${name}" must be a number.` };
      }
      if (property.type === "integer" && !Number.isInteger(num)) {
        return { error: `"${name}" must be a whole number.` };
      }
      if (property.minimum !== undefined && num < property.minimum) {
        return { error: `"${name}" must be ${property.minimum} or more.` };
      }
      if (property.maximum !== undefined && num > property.maximum) {
        return { error: `"${name}" must be ${property.maximum} or less.` };
      }
      return { value: num };
    }

    case "boolean": {
      if (typeof raw === "boolean") return { value: raw };
      if (raw === "true") return { value: true };
      if (raw === "false") return { value: false };
      return { error: `"${name}" must be true or false.` };
    }

    case "array": {
      if (!Array.isArray(raw)) return { error: `"${name}" must be an array.` };
      if (property.maxItems && raw.length > property.maxItems) {
        return { error: `"${name}" must have ${property.maxItems} items or fewer.` };
      }
      if (!property.items) return { value: raw };
      const items: unknown[] = [];
      for (const [index, item] of raw.entries()) {
        const checked = checkValue(`${name}[${index}]`, property.items, item);
        if ("error" in checked) return { error: checked.error };
        items.push(checked.value);
      }
      return { value: items };
    }
  }
}

/**
 * The largest argument object we will send on: 64 KB of JSON.
 *
 * A model that has just read somebody's mailbox can write arguments as big as it likes,
 * and a tool call is the way that content leaves Omnix. Approval is the real defence
 * (D10), but a cap costs nothing and keeps a runaway call from being a large upload to
 * someone else's server.
 */
const MAX_ARGS_BYTES = 64 * 1024;

/**
 * Checks arguments against a schema we didn't write — an MCP server's.
 *
 * Deliberately loose. The server owns the contract and validates against it properly,
 * answering a bad call with an error the model can read, so the only things worth
 * checking here are the ones a remote round trip shouldn't be spent on: that it is an
 * object at all, that the required fields are present, and that it isn't enormous.
 *
 * Unlike `validateArgs`, **nothing is dropped**. Whatever the model wrote is what the
 * server is asked to do, which is also what makes an approval card honest.
 */
export function validateOpenArgs(
  schema: Record<string, unknown>,
  args: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { ok: false, error: "Arguments must be a JSON object." };
  }

  const input = args as Record<string, unknown>;

  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const name of required) {
    if (typeof name !== "string") continue;
    if (input[name] === undefined || input[name] === null) {
      return { ok: false, error: `Missing required argument "${name}".` };
    }
  }

  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(input) ?? "", "utf8");
  } catch {
    // Circular, or something else that can't be sent as JSON at all.
    return { ok: false, error: "Arguments couldn't be encoded as JSON." };
  }
  if (size > MAX_ARGS_BYTES) {
    return {
      ok: false,
      error: `Those arguments are too large (${Math.round(size / 1024)} KB; the limit is ${MAX_ARGS_BYTES / 1024} KB). Send less.`,
    };
  }

  return { ok: true, value: input };
}

/**
 * Checks a tool call's arguments the right way for that tool: strictly against our own
 * schema, or loosely against a schema its server published (`openParameters`).
 *
 * One function so the runner doesn't have to know which kind of tool it is holding.
 */
export function checkToolArgs(
  tool: { parameters: JsonSchema; openParameters?: Record<string, unknown> },
  args: unknown,
) {
  return tool.openParameters
    ? validateOpenArgs(tool.openParameters, args)
    : validateArgs(tool.parameters, args);
}
