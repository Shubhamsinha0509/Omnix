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
