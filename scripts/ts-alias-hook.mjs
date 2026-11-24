/**
 * Resolves the app's "@/" alias for scripts run straight through Node.
 *
 * Node strips TypeScript types but has no tsconfig-paths support, so `@/lib/mcp/servers`
 * means nothing to it. This maps the prefix onto the project root and then tries the
 * extensions a TS project leaves off, which is what lets a script import the real modules
 * instead of a copy of them.
 *
 * Registered by the script that needs it (see `scripts/verify-mcp.ts`).
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..").split(path.sep).join("/");

const isFile = (candidate) => existsSync(candidate) && statSync(candidate).isFile();

/** A file wins over a directory of the same name: "@/db" means db/index.ts. */
function firstExisting(base) {
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(isFile);
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const found = firstExisting(`${root}/${specifier.slice(2)}`);
    if (found) return next(pathToFileURL(found).href, context);
  }

  // Imports inside those modules are extensionless too ("./store").
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.startsWith("file:")
  ) {
    const target = new URL(specifier, new URL(".", context.parentURL));
    const asPath = decodeURIComponent(target.pathname).replace(/^\//, "");
    if (!isFile(asPath)) {
      const found = firstExisting(asPath);
      if (found) return next(pathToFileURL(found).href, context);
    }
  }

  return next(specifier, context);
}
