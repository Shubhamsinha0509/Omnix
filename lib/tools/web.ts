import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch, type Response } from "undici";

import { extractTitle, htmlToText } from "@/lib/html-text";
import type { NativeToolDefinition, ToolDefinition } from "./types";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 600_000; // stop downloading long before a huge page fills memory
const MAX_REDIRECTS = 3;
const DEFAULT_MAX_CHARS = 8_000;

/** Content we can turn into text for the model. Anything else is refused. */
const READABLE_TYPES = [
  "text/html",
  "text/plain",
  "text/markdown",
  "application/xhtml+xml",
  "application/json",
  "application/xml",
  "text/xml",
];

/**
 * Web search, run by OpenRouter itself as a server tool: the model decides when to
 * search and with what query, OpenRouter runs it and feeds the results straight back.
 * We declare it and log the sources it cited; there is no request of ours to execute.
 *
 * It works with any tool-calling model, so it survives a change of `CHAT_MODEL`, and it
 * is billed per search on top of tokens. See decision D27.
 */
export const webSearch: NativeToolDefinition = {
  key: "web.search",
  label: "Searching the web",
  risk: "read",
  native: "openrouter:web_search",
};

/**
 * Fetches one URL and returns its readable text.
 *
 * Two things matter here. The URL comes from a model that may be repeating something
 * it read on a web page, so it is treated as hostile: only public http(s) addresses are
 * allowed, and every redirect is re-checked (see `assertPublicUrl`). And the text that
 * comes back is untrusted content, so the runner labels it as data for the model.
 */
export const webFetch: ToolDefinition = {
  key: "web.fetch",
  label: "Reading the page",
  description:
    "Fetch a public web page or JSON API by URL and return its text. Use this to read a page " +
    "the user linked to, or a result from a web search. Only public http(s) URLs work.",
  risk: "read",
  runsIn: "server",
  untrustedOutput: true,
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The full URL to fetch, including http:// or https://.",
        maxLength: 2000,
      },
      maxChars: {
        type: "integer",
        description: `How much text to return. Default ${DEFAULT_MAX_CHARS}, maximum 30000.`,
        minimum: 500,
        maximum: 30_000,
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const maxChars = typeof args.maxChars === "number" ? args.maxChars : DEFAULT_MAX_CHARS;
    let target: string;
    try {
      target = normaliseUrl(String(args.url));
    } catch (error) {
      return { error: (error as Error).message };
    }

    // One timeout for the whole thing, also cancelled when the user stops the reply.
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const signal = AbortSignal.any([timeout, ctx.signal]);

    let response: Response;
    let redirects = 0;
    try {
      while (true) {
        // A friendly early answer for obviously private targets. The binding check is
        // `publicOnlyLookup`, which runs when the socket actually connects.
        await assertPublicUrl(target);
        response = await fetch(target, {
          signal,
          dispatcher: publicOnlyAgent,
          redirect: "manual", // follow by hand so each hop is checked again
          headers: {
            // Identify ourselves honestly; some sites block unknown clients outright.
            "User-Agent": "Omnix-Agent/1.0 (+https://omnix.app)",
            Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5",
          },
        });

        const location = response.headers.get("location");
        if (response.status >= 300 && response.status < 400 && location) {
          // Release the connection: the redirect's body is never read.
          await discard(response);
          if (++redirects > MAX_REDIRECTS) return { error: "Too many redirects." };
          target = normaliseUrl(new URL(location, target).toString());
          continue;
        }
        break;
      }
    } catch (error) {
      if (timeout.aborted) return { error: `The page took longer than ${FETCH_TIMEOUT_MS / 1000}s to load.` };
      if (ctx.signal.aborted) return { error: "Cancelled." };
      return { error: `Couldn't reach that URL: ${describeFetchError(error)}` };
    }

    if (!response.ok) {
      await discard(response);
      return { error: `The site returned ${response.status} ${response.statusText}.` };
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!READABLE_TYPES.some((type) => contentType.includes(type))) {
      await discard(response);
      return { error: `That URL isn't readable text (content type: ${contentType || "unknown"}).` };
    }

    let raw: string;
    try {
      raw = await readCapped(response, signal);
    } catch (error) {
      if (ctx.signal.aborted) return { error: "Cancelled." };
      return { error: `Couldn't read the page: ${(error as Error).message}` };
    }

    const isHtml = contentType.includes("html") || contentType.includes("xml");
    const title = isHtml ? extractTitle(raw) : undefined;
    const text = isHtml ? htmlToText(raw) : raw.trim();
    const truncated = text.length > maxChars;

    return {
      output: {
        url: target,
        title,
        contentType: contentType.split(";")[0],
        truncated,
        text: truncated ? `${text.slice(0, maxChars)}\n\n[...truncated]` : text,
      },
    };
  },
};

/** Rejects anything that isn't a plain public http(s) URL. */
function normaliseUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("That isn't a valid URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http:// and https:// URLs can be fetched.");
  }
  if (url.username || url.password) {
    throw new Error("URLs with a username or password aren't allowed.");
  }
  return url.toString();
}

/**
 * Resolves the hostname and refuses private addresses.
 *
 * Our server can reach things the user never could: localhost, the database, cloud
 * metadata endpoints that hand out credentials. A web page could tell the agent to
 * "check http://169.254.169.254/" — so the check is on the resolved IP, not the name.
 */
async function assertPublicUrl(input: string) {
  const { hostname } = new URL(input);
  const host = hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => {
        throw new Error(`Couldn't find the host "${host}".`);
      });

  if (addresses.length === 0) throw new Error(`Couldn't find the host "${host}".`);
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error("That address is on a private network and can't be fetched.");
    }
  }
}

/**
 * DNS lookup used for every connection `web.fetch` makes. It refuses the connection if
 * the name resolves to a private address, and the socket then connects to exactly the
 * address checked here — so a DNS answer that changes between our check and the connect
 * (DNS rebinding) can't slip a private address through. Host header and TLS name are
 * untouched, because only the address resolution is replaced.
 *
 * Node skips `lookup` for IP literals, which is why `assertPublicUrl` still checks those.
 */
function publicOnlyLookup(
  hostname: string,
  options: LookupOptions | number | undefined,
  callback: (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
) {
  const opts: LookupOptions = typeof options === "object" && options !== null ? options : {};
  dnsLookup(hostname, { ...opts, all: true }, (error: NodeJS.ErrnoException | null, list: LookupAddress[]) => {
    if (error) return callback(error, opts.all ? [] : "");
    if (list.length === 0 || list.some((entry) => isPrivateAddress(entry.address))) {
      return callback(
        Object.assign(new Error("That address is on a private network and can't be fetched."), {
          code: "EPRIVATE",
        }),
        opts.all ? [] : "",
      );
    }
    if (opts.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

/** Connection pool for `web.fetch` only: every connection goes through the check above. */
const publicOnlyAgent = new Agent({ connect: { lookup: publicOnlyLookup } });

/** Lets go of a response we aren't going to read, so its connection is freed. */
async function discard(response: Response) {
  await response.body?.cancel().catch(() => {});
}

/** undici wraps connection errors; surface the reason we gave, not "fetch failed". */
function describeFetchError(error: unknown) {
  const cause = (error as { cause?: unknown })?.cause;
  if (cause instanceof Error) return cause.message;
  return (error as Error)?.message ?? "unknown error";
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const ip = address.toLowerCase();
    if (ip === "::" || ip === "::1") return true;
    if (ip.startsWith("fe80") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
    // IPv4 written as IPv6. The URL parser normalises ::ffff:127.0.0.1 to the hex form
    // ::ffff:7f00:1, so both spellings must be recognised.
    const dotted = ip.match(/^(?:0{0,4}:){0,5}:?ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivateAddress(dotted[1]);
    const hex = ip.match(/^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const high = parseInt(hex[1], 16);
      const low = parseInt(hex[2], 16);
      return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return false;
  }

  const [a, b] = address.split(".").map(Number);
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, including cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0) || // protocol assignments
    a >= 224 // multicast and reserved
  );
}

/** Reads the body but stops at MAX_BYTES, so one huge page can't take the server down. */
async function readCapped(response: Response, signal: AbortSignal) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let text = "";
  let bytes = 0;

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (bytes >= MAX_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}
