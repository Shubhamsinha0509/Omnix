/**
 * Production refuses free or missing models (lib/ai.ts, D59). In-process: no database,
 * no network, no model call.
 *
 *   npm run verify:model
 */
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(pathToFileURL(path.join(import.meta.dirname, "ts-alias-hook.mjs")));

let passed = 0;
let failed = 0;
function check(name: string, condition: unknown, detail?: unknown) {
  if (condition) passed++;
  else failed++;
  console.log(`  ${condition ? "ok  " : "FAIL"} ${name}${condition || detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
}

const PAID = "deepseek/deepseek-chat-v3.1";

async function main() {
  const { isProduction, modelConfigProblem, getModelClient, ModelSetupError, MODEL_SETUP_MESSAGE } = await import("@/lib/ai");
  const { friendlyModelError } = await import("@/lib/agent/errors");

  console.log("\n== Where counts as production");
  check("development is not", !isProduction({ NODE_ENV: "development" }));
  check("NODE_ENV=production is", isProduction({ NODE_ENV: "production" }));
  check("a Vercel preview is", isProduction({ VERCEL_ENV: "preview" }));
  check("Vercel development is not", !isProduction({ VERCEL_ENV: "development" }));

  console.log("\n== What production accepts");
  check("locally, an unset model is fine (free default)", modelConfigProblem({ NODE_ENV: "development" }) === null);
  check("locally, a free model is fine", modelConfigProblem({ NODE_ENV: "development", OPENROUTER_MODEL: "x/y:free" }) === null);
  const prod = (OPENROUTER_MODEL?: string) => modelConfigProblem({ NODE_ENV: "production", OPENROUTER_MODEL });
  check("unset is refused", /not set/.test(prod() ?? ""), prod());
  check("blank is refused", /not set/.test(prod("   ") ?? ""), prod("   "));
  check("a malformed id is refused", /doesn't look like/.test(prod("deepseek") ?? ""), prod("deepseek"));
  check("a :free model is refused", /free model/.test(prod("nvidia/nemotron-3-ultra-550b-a55b:free") ?? ""));
  check("OpenRouter's free router is refused", /free model/.test(prod("openrouter/free") ?? ""));
  check("a paid model passes", prod(PAID) === null, prod(PAID));

  console.log("\n== Every model call is guarded");
  const saved = { ...process.env };
  Object.assign(process.env, { NODE_ENV: "production", OPENROUTER_MODEL: "x/y:free", OPENROUTER_API_KEY: "fake" });
  let thrown: unknown;
  try {
    getModelClient();
  } catch (error) {
    thrown = error;
  }
  check("getModelClient throws ModelSetupError", thrown instanceof ModelSetupError, String(thrown));
  check("users see the plain message, not env var names", friendlyModelError(thrown) === MODEL_SETUP_MESSAGE);
  const viaInngest = JSON.parse(JSON.stringify({ name: (thrown as Error)?.name, message: (thrown as Error)?.message }));
  check("…also after a background run's JSON round trip", friendlyModelError(viaInngest) === MODEL_SETUP_MESSAGE);
  Object.assign(process.env, { OPENROUTER_MODEL: PAID });
  let client: unknown;
  try {
    client = getModelClient();
  } catch (error) {
    client = error;
  }
  check("with a paid model the client is created", !(client instanceof Error), String(client));
  process.env = saved;

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
