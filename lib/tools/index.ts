/**
 * The tool layer's front door. Everything outside `lib/tools` imports from here.
 *
 * - `types` — what a tool is.
 * - `registry` — every tool there is, and how one is put on the wire.
 * - `selection` — which of them a given agent may use, and with which account.
 * - `schema` — checking the arguments a model wrote.
 */
export * from "./types";
export * from "./registry";
export * from "./selection";
export { validateArgs } from "./schema";
