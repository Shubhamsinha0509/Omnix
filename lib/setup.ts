/**
 * What users are told when part of the server isn't configured (D60).
 *
 * Locally the person reading is the developer, so the notice says exactly what to set.
 * In production it's a user, who can't fix it and shouldn't see the server's settings: they
 * get a plain "isn't available" and the detail goes to the server log instead.
 *
 * Safe to import from client components: they pass `production` themselves, as
 * `process.env.NODE_ENV === "production"` (which Next inlines), so the default that reads
 * `process.env` never runs in the browser.
 */

export type ServerEnv = Record<string, string | undefined>;

/** A production build or a non-development Vercel deployment. */
export function isProduction(env: ServerEnv = process.env) {
  const vercel = env.VERCEL_ENV?.trim();
  return Boolean(env.NODE_ENV?.startsWith("prod") || (vercel && vercel !== "development"));
}

/**
 * "VMs aren't set up yet: add E2B_API_KEY to .env and restart the dev server." locally;
 * "VMs aren't available on this server right now." in production.
 *
 * @param feature what's missing, as the subject of the sentence ("AI", "VMs").
 * @param devFix the instruction for a developer, ending in a full stop.
 */
export function setupNotice(feature: string, devFix: string, production: boolean = isProduction()) {
  const plural = /s$/.test(feature);
  return production
    ? `${feature} ${plural ? "aren't" : "isn't"} available on this server right now.`
    : `${feature} ${plural ? "aren't" : "isn't"} set up yet: ${devFix}`;
}

/** The same, for a sentence that isn't about one feature: the developer's text, or a plain one. */
export function devOnly(devText: string, productionText: string, production: boolean = isProduction()) {
  return production ? productionText : devText;
}
