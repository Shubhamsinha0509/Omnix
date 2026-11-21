/**
 * Visual comparison: the running app next to a reference screen from design/reference.
 *
 *   node scripts/compare.ts <app route> <reference file> [options]
 *   node scripts/compare.ts /workspace 03-home
 *   node scripts/compare.ts /workspace 04-home-profile-menu --click "[data-slot=profile-trigger]"
 *
 * Saves design/compare/<name>-<width>-<theme>.png for 1440×900 and 390×844 in light and
 * dark: the reference on the left, the app on the right, each a full-page capture.
 *
 * Options
 *   --name <name>        output name (default: the reference file name)
 *   --widths 1440,390    which widths
 *   --themes light,dark  which themes
 *   --click <selector>   click this in the app before capturing (repeatable, in order)
 *   --wait <ms>          extra settle time after load (default 1200)
 *   --viewport           capture the viewport only, not the full page
 *   --base <url>         app origin (default http://localhost:3000)
 *
 * Signed in: the script reads NEXTAUTH_SECRET and DATABASE_URL from .env and mints a
 * session for the first user, exactly as NextAuth would. That needs the secret, which only
 * this machine has, so the app's real sign-in is untouched. Run `npm run dev` first.
 *
 * Theme: the app uses next-themes (localStorage "theme"); the reference files go dark with
 * `#dark` in the URL.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { chromium, type Page } from "playwright";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");

type Options = {
  route: string;
  reference: string;
  name: string;
  widths: number[];
  themes: ("light" | "dark")[];
  clicks: string[];
  wait: number;
  fullPage: boolean;
  base: string;
};

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const clicks: string[] = [];
  const flags: Record<string, string> = {};
  let fullPage = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--viewport") fullPage = false;
    else if (arg === "--click") clicks.push(argv[++i]);
    else if (arg.startsWith("--")) flags[arg.slice(2)] = argv[++i];
    else positional.push(arg);
  }
  const [route, ref] = positional;
  if (!route || !ref) {
    console.error("usage: node scripts/compare.ts <app route> <reference file> [options]");
    process.exit(1);
  }
  const reference = ref.replace(/\.html$/, "");
  // Git Bash rewrites "/workspace" to "C:/Program Files/Git/workspace" before Node sees it.
  const unmangled = route.replace(/^[A-Za-z]:[\\/].*?[\\/]Git[\\/]/, "/").replace(/\\/g, "/");
  return {
    route: unmangled.startsWith("/") ? unmangled : `/${unmangled}`,
    reference,
    name: flags.name ?? reference,
    widths: (flags.widths ?? "1440,390").split(",").map(Number),
    themes: (flags.themes ?? "light,dark").split(",") as ("light" | "dark")[],
    clicks,
    wait: Number(flags.wait ?? 1200),
    fullPage,
    base: flags.base ?? "http://localhost:3000",
  };
}

/** A NextAuth session cookie for the first user, minted with this machine's secret. */
async function sessionCookie() {
  require("@next/env").loadEnvConfig(root, true, { info() {}, error() {} });
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || !process.env.DATABASE_URL) return null;
  const { encode } = require("next-auth/jwt");
  const sql = require("postgres")(process.env.DATABASE_URL, { prepare: false, max: 1 });
  try {
    const [user] = await sql`select id, email, name from users order by id limit 1`;
    if (!user) return null;
    return await encode({
      token: { email: user.email, name: user.name, sub: String(user.id) },
      secret,
    });
  } finally {
    await sql.end();
  }
}

const heightFor = (width: number) => (width < 768 ? 844 : 900);

async function settle(page: Page, wait: number) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(wait);
}

/**
 * Both the reference screens and the app's full-height layouts (`h-svh`) keep the document
 * at exactly one viewport and clip or scroll inside it, so a plain full-page capture would
 * cut them off. Instead, grow the viewport until every clipped or scrolling area fits.
 */
async function growToContent(page: Page, width: number) {
  for (let i = 0; i < 4; i++) {
    const { current, needed } = await page.evaluate(() => {
      let bottom = document.documentElement.scrollHeight;
      for (const el of document.querySelectorAll<HTMLElement>("body *")) {
        const style = getComputedStyle(el);
        if (style.position === "fixed" || style.display === "none") continue;
        const hidden = el.scrollHeight - el.clientHeight;
        if (hidden > 1 && /(hidden|auto|scroll|clip)/.test(style.overflowY)) {
          bottom = Math.max(bottom, el.getBoundingClientRect().top + window.scrollY + el.scrollHeight);
        }
      }
      return { current: window.innerHeight, needed: Math.ceil(bottom) };
    });
    if (needed <= current + 1) return;
    await page.setViewportSize({ width, height: Math.min(needed, 8000) });
    await page.waitForTimeout(250);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const referenceFile = path.join(root, "design", "reference", `${options.reference}.html`);
  if (!fs.existsSync(referenceFile)) throw new Error(`No reference file ${referenceFile}`);
  const outDir = path.join(root, "design", "compare");
  fs.mkdirSync(outDir, { recursive: true });

  const token = await sessionCookie();
  if (!token) console.warn("No session (missing NEXTAUTH_SECRET/DATABASE_URL or users): capturing signed out.");

  // The installed Edge, so nothing has to be downloaded; falls back to Playwright's Chromium.
  const browser = await chromium.launch({ channel: "msedge" }).catch(() => chromium.launch());
  const saved: string[] = [];

  try {
    for (const width of options.widths) {
      for (const theme of options.themes) {
        const viewport = { width, height: heightFor(width) };
        const context = await browser.newContext({
          viewport,
          deviceScaleFactor: 1,
          isMobile: width < 768,
          hasTouch: width < 768,
          colorScheme: theme,
          reducedMotion: "reduce",
        });
        if (token) {
          await context.addCookies([
            { name: "next-auth.session-token", value: token, domain: "localhost", path: "/", httpOnly: true, sameSite: "Lax" },
          ]);
        }
        await context.addInitScript((value) => {
          try {
            localStorage.setItem("theme", value);
          } catch {}
        }, theme);

        // Reference
        const ref = await context.newPage();
        const refUrl = pathToFileURL(referenceFile).href + (theme === "dark" ? "#dark" : "");
        await ref.goto(refUrl);
        await settle(ref, 300);
        if (options.fullPage) await growToContent(ref, width);
        const refShot = await ref.screenshot({ fullPage: options.fullPage });

        // App
        const app = await context.newPage();
        const errors: string[] = [];
        app.on("pageerror", (error) => errors.push(error.message));
        app.on("console", (msg) => {
          if (msg.type() === "error") errors.push(msg.text());
        });
        const response = await app.goto(options.base + options.route, { timeout: 90_000 });
        await settle(app, options.wait);
        for (const selector of options.clicks) {
          await app.locator(selector).first().click({ timeout: 10_000 });
          await app.waitForTimeout(500);
        }
        if (options.fullPage) await growToContent(app, width);
        const appShot = await app.screenshot({ fullPage: options.fullPage });

        // Side by side, labelled.
        const sheet = await context.newPage();
        await sheet.setViewportSize({ width: width * 2 + 48, height: 400 });
        const img = (buffer: Buffer) => `data:image/png;base64,${buffer.toString("base64")}`;
        await sheet.setContent(`<!doctype html><html><body style="margin:0;background:#888;font:600 14px system-ui">
          <div style="display:flex;gap:16px;padding:16px;align-items:flex-start">
            <figure style="margin:0"><figcaption style="padding:0 0 8px">Reference · ${options.reference} · ${width} · ${theme}</figcaption><img src="${img(refShot)}" style="display:block;width:${width}px"></figure>
            <figure style="margin:0"><figcaption style="padding:0 0 8px">App · ${options.route} · ${response?.status() ?? "?"}</figcaption><img src="${img(appShot)}" style="display:block;width:${width}px"></figure>
          </div></body></html>`);
        await sheet.waitForTimeout(200);
        const file = path.join(outDir, `${options.name}-${width}-${theme}.png`);
        await sheet.screenshot({ path: file, fullPage: true });
        saved.push(file);

        const unique = [...new Set(errors)].filter((e) => !e.includes("Download the React DevTools"));
        console.log(
          `${options.name} ${width} ${theme}: HTTP ${response?.status()}` +
            (unique.length ? `\n  browser errors:\n  - ${unique.slice(0, 5).join("\n  - ")}` : ""),
        );
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(saved.map((file) => path.relative(root, file)).join("\n"));
}

main().catch((error) => {
  console.error("compare failed:", error.message);
  process.exit(1);
});
