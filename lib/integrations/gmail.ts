import { htmlToText } from "@/lib/html-text";
import { ConnectionError, type ToolAuth } from "./access";

/**
 * The Gmail API, as much of it as the Phase 3 tools need.
 *
 * Hand-written over `fetch` rather than pulled in through `googleapis`: four endpoints
 * don't justify a dependency that bundles the whole of Google, and the parts that
 * actually need care here — turning real-world MIME into text a model can read, and
 * building an outgoing message without letting the model inject headers — are ours
 * either way. See docs/05-integrations.md#gmail.
 */

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TIMEOUT_MS = 20_000;

/** Messages fetched in parallel for one search. Enough to be quick, not enough to be rude. */
const SEARCH_CONCURRENCY = 5;

/** Caps that keep one tool call from filling the model's context or the user's outbox. */
export const GMAIL_LIMITS = {
  maxSearchResults: 25,
  defaultSearchResults: 10,
  maxBodyChars: 20_000,
  defaultBodyChars: 6_000,
  /** Recipients in one draft or send, across to + cc + bcc — blast radius, not a quota. */
  maxRecipients: 10,
  maxSubjectChars: 400,
  maxComposeBodyChars: 20_000,
};

export class GmailError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GmailError";
    this.status = status;
  }
}

export type MessageSummary = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  /** Gmail's own one-line preview. */
  snippet: string;
  unread: boolean;
  labels: string[];
};

export type MessageDetail = MessageSummary & {
  cc?: string;
  /** The RFC 5322 `Message-ID`, which a reply needs for `In-Reply-To`. */
  messageIdHeader?: string;
  body: string;
  bodyTruncated: boolean;
  attachments: { filename: string; mimeType: string; bytes: number }[];
};

/** The address the connection belongs to. Used to label it at connect time. */
export async function fetchEmailAddress(accessToken: string) {
  const response = await fetch(`${API}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => null)) as { emailAddress?: string } | null;
  if (!response.ok || !payload?.emailAddress) {
    throw new GmailError("Couldn't read the Google account's email address.", response.status);
  }
  return payload.emailAddress;
}

/**
 * Searches the mailbox with Gmail's own query syntax and returns one line per message.
 *
 * Gmail's list endpoint hands back ids and nothing else, so each hit needs a second
 * request for its headers. That is the slow part, hence the small amount of parallelism.
 */
export async function searchMessages(
  auth: ToolAuth,
  options: { query: string; maxResults: number; signal: AbortSignal },
): Promise<{ messages: MessageSummary[]; estimatedTotal: number }> {
  const search = new URLSearchParams({
    q: options.query,
    maxResults: String(options.maxResults),
  });

  const list = await request<{
    messages?: { id: string }[];
    resultSizeEstimate?: number;
  }>(auth, `/messages?${search}`, { signal: options.signal });

  const ids = (list.messages ?? []).map((message) => message.id);
  const messages: MessageSummary[] = [];

  for (let at = 0; at < ids.length; at += SEARCH_CONCURRENCY) {
    const batch = await Promise.all(
      ids.slice(at, at + SEARCH_CONCURRENCY).map((id) =>
        request<RawMessage>(auth, `/messages/${id}?${METADATA_QUERY}`, { signal: options.signal }).catch(
          // One unreadable message shouldn't lose the user their whole search.
          () => null,
        ),
      ),
    );
    for (const raw of batch) if (raw) messages.push(summarise(raw));
  }

  return { messages, estimatedTotal: list.resultSizeEstimate ?? messages.length };
}

/** One message in full: headers, readable body and what was attached. */
export async function getMessage(
  auth: ToolAuth,
  options: { id: string; maxChars: number; signal: AbortSignal },
): Promise<MessageDetail> {
  const raw = await request<RawMessage>(auth, `/messages/${options.id}?format=full`, {
    signal: options.signal,
  });

  const { text, attachments } = readBody(raw.payload);
  const truncated = text.length > options.maxChars;

  return {
    ...summarise(raw),
    cc: header(raw, "Cc"),
    messageIdHeader: header(raw, "Message-ID"),
    body: truncated ? `${text.slice(0, options.maxChars)}\n\n[...truncated]` : text,
    bodyTruncated: truncated,
    attachments,
  };
}

export type Compose = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  /** Keeps a reply in its original thread. */
  threadId?: string;
  /** The original's `Message-ID`, so mail clients thread the reply properly. */
  inReplyTo?: string;
};

/** Saves a draft in Gmail. Nothing is sent. */
export async function createDraft(auth: ToolAuth, compose: Compose, signal: AbortSignal) {
  const draft = await request<{ id: string; message?: { id: string; threadId: string } }>(
    auth,
    "/drafts",
    {
      method: "POST",
      body: {
        message: {
          raw: buildRaw(compose),
          ...(compose.threadId ? { threadId: compose.threadId } : {}),
        },
      },
      signal,
    },
  );
  return { draftId: draft.id, messageId: draft.message?.id, threadId: draft.message?.threadId };
}

/** Sends a message. The irreversible one — it only ever runs through an approval. */
export async function sendMessage(auth: ToolAuth, compose: Compose, signal: AbortSignal) {
  const sent = await request<{ id: string; threadId: string }>(auth, "/messages/send", {
    method: "POST",
    body: {
      raw: buildRaw(compose),
      ...(compose.threadId ? { threadId: compose.threadId } : {}),
    },
    signal,
  });
  return { messageId: sent.id, threadId: sent.threadId };
}

/**
 * Looks for a message this run already sent, so a retry doesn't send it twice.
 *
 * Background runs are made of durable steps, and a worker that dies after the send but
 * before the step is recorded will run it again (docs/04-agent-runtime.md#triggers).
 * Gmail has no idempotency key, so the check is "is it already in Sent?" — matched on
 * recipient and subject within the last ten minutes.
 */
export async function findRecentlySent(
  auth: ToolAuth,
  compose: Pick<Compose, "to" | "subject">,
  signal: AbortSignal,
) {
  const query = [
    "in:sent",
    "newer_than:1d",
    `to:${quoteQueryValue(compose.to[0] ?? "")}`,
    `subject:${quoteQueryValue(compose.subject)}`,
  ].join(" ");

  const found = await searchMessages(auth, { query, maxResults: 3, signal }).catch(() => null);
  if (!found) return null;

  const cutoff = Date.now() - 10 * 60_000;
  return (
    found.messages.find((message) => {
      const at = Date.parse(message.date);
      return Number.isFinite(at) && at >= cutoff;
    }) ?? null
  );
}

// ---------------------------------------------------------------------------- requests

/** Only the headers worth a round trip for a search result. */
const METADATA_QUERY =
  "format=metadata&" + ["From", "To", "Subject", "Date"].map((name) => `metadataHeaders=${name}`).join("&");

type RawMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  labelIds?: string[];
  payload?: RawPart;
};

type RawPart = {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: RawPart[];
};

async function request<T>(
  auth: ToolAuth,
  path: string,
  options: { method?: string; body?: unknown; signal: AbortSignal },
): Promise<T> {
  const token = await auth.token();

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
  } catch (error) {
    if (options.signal.aborted) throw new GmailError("Cancelled.", 0);
    throw new GmailError(`Couldn't reach Gmail: ${(error as Error).message}`, 0);
  }

  if (response.ok) return (await response.json()) as T;

  const payload = (await response.json().catch(() => null)) as
    | { error?: { message?: string; status?: string } }
    | null;
  const detail = payload?.error?.message ?? response.statusText;

  // 401 means the token is no longer accepted at all, whatever our stored expiry said.
  if (response.status === 401) {
    await auth.markRevoked();
    throw new ConnectionError(
      `Gmail rejected the connection to ${auth.accountLabel}. Ask the user to reconnect it on the Connections page.`,
    );
  }
  if (response.status === 403 && /insufficient|scope/i.test(detail)) {
    throw new ConnectionError(
      `The connection to ${auth.accountLabel} wasn't granted permission for this. Ask the user to reconnect it and approve every box.`,
    );
  }

  throw new GmailError(detail, response.status);
}

// ----------------------------------------------------------------------------- reading

function summarise(raw: RawMessage): MessageSummary {
  return {
    id: raw.id,
    threadId: raw.threadId,
    from: header(raw, "From") ?? "",
    to: header(raw, "To") ?? "",
    subject: header(raw, "Subject") ?? "(no subject)",
    date: header(raw, "Date") ?? "",
    snippet: raw.snippet ?? "",
    unread: (raw.labelIds ?? []).includes("UNREAD"),
    labels: (raw.labelIds ?? []).filter((label) => !label.startsWith("CATEGORY_")),
  };
}

function header(raw: RawMessage, name: string) {
  const match = raw.payload?.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  return match?.value;
}

/**
 * Walks a message's MIME tree for something readable.
 *
 * Real email is a nested mess: `multipart/alternative` with a plain and an HTML copy of
 * the same thing, `multipart/mixed` wrapping that plus attachments, and forwarded mail
 * nesting the lot again. Plain text is preferred where it exists, HTML is flattened where
 * it doesn't, and attachments are listed rather than downloaded.
 */
function readBody(payload: RawPart | undefined) {
  const plain: string[] = [];
  const html: string[] = [];
  const attachments: MessageDetail["attachments"] = [];

  const walk = (part: RawPart | undefined, depth: number) => {
    if (!part || depth > 10) return;

    // A part with a filename is an attachment even when its type says text.
    if (part.filename && (part.body?.attachmentId || part.body?.size)) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        bytes: part.body?.size ?? 0,
      });
      return;
    }

    if (part.body?.data) {
      const text = Buffer.from(part.body.data, "base64url").toString("utf8");
      if (part.mimeType === "text/plain") plain.push(text);
      else if (part.mimeType === "text/html") html.push(htmlToText(text));
    }

    for (const child of part.parts ?? []) walk(child, depth + 1);
  };

  walk(payload, 0);

  const text = (plain.length > 0 ? plain : html).join("\n\n").replace(/\r\n/g, "\n").trim();
  return { text, attachments };
}

// ----------------------------------------------------------------------------- writing

/**
 * Builds the RFC 5322 message Gmail wants, base64url encoded.
 *
 * Every value here was written by a model that may be repeating something out of an
 * email, so the headers are the dangerous part: a newline inside a subject or a recipient
 * would start a header of somebody else's choosing — a `Bcc:` for instance. Addresses are
 * checked against a strict shape and header values are stripped of control characters, so
 * neither can carry one.
 *
 * `From` is deliberately absent: Gmail fills it in from the authenticated account, so the
 * agent cannot send as somebody else even if it tries.
 */
function buildRaw(compose: Compose) {
  const lines = [`To: ${addressList(compose.to)}`];
  if (compose.cc?.length) lines.push(`Cc: ${addressList(compose.cc)}`);
  if (compose.bcc?.length) lines.push(`Bcc: ${addressList(compose.bcc)}`);
  lines.push(`Subject: ${encodeHeaderValue(compose.subject)}`);

  if (compose.inReplyTo) {
    const reference = sanitiseMessageId(compose.inReplyTo);
    if (reference) lines.push(`In-Reply-To: ${reference}`, `References: ${reference}`);
  }

  lines.push(
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    // Base64 sidesteps the whole business of line lengths and 8-bit characters in the body.
    "Content-Transfer-Encoding: base64",
    "",
    wrap(Buffer.from(compose.body, "utf8").toString("base64")),
  );

  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

/** `name@example.com` or `Name <name@example.com>`, and nothing else. */
const BARE_ADDRESS = /^[^\s<>@,;:"\x5c]+@[^\s<>@,;:"\x5c]+\.[^\s<>@,;:"\x5c]{2,}$/;
const NAMED_ADDRESS =
  /^([^<>@,;:"\x5c\r\n]{1,100}?)\s*<([^\s<>@,;:"\x5c]+@[^\s<>@,;:"\x5c]+\.[^\s<>@,;:"\x5c]{2,})>$/;

/**
 * Checks one recipient and returns it in a form that is safe in a header.
 *
 * Throws rather than quietly dropping it: an email to the wrong person — or to nobody —
 * is far worse than a tool error the model can read and explain.
 */
export function normaliseAddress(input: string) {
  // eslint-disable-next-line no-control-regex
  const value = input.replace(/[\r\n\t\u0000-\u001f\u007f]/g, "").trim();

  if (BARE_ADDRESS.test(value)) return value;

  const named = value.match(NAMED_ADDRESS);
  if (named) {
    const display = named[1].replace(/"/g, "").trim();
    return display ? `${encodeHeaderValue(display, true)} <${named[2]}>` : named[2];
  }

  throw new GmailError(`"${input}" isn't a valid email address.`, 400);
}

function addressList(addresses: string[]) {
  return addresses.map(normaliseAddress).join(", ");
}

/**
 * RFC 2047 encodes a header value when it isn't plain ASCII, so an accented name or a
 * subject with an emoji arrives intact rather than as mojibake. Control characters go
 * first either way, because they are what a header injection is made of.
 */
function encodeHeaderValue(value: string, quoteIfPlain = false) {
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\r\n\u0000-\u001f\u007f]/g, " ").trim();
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(clean)) {
    return quoteIfPlain && /[",;:<>@]/.test(clean) ? `"${clean.replace(/"/g, "")}"` : clean;
  }
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/** A `Message-ID` is `<something@host>`; anything else can't be trusted in a header. */
function sanitiseMessageId(value: string) {
  const clean = value.replace(/[\r\n\s]/g, "");
  return /^<[^<>@]+@[^<>@]+>$/.test(clean) ? clean : null;
}

/** Base64 bodies go in 76-character lines, as MIME asks. */
function wrap(base64: string) {
  return base64.replace(/(.{76})/g, "$1\r\n");
}

/** Escapes a value going into a Gmail search query. */
function quoteQueryValue(value: string) {
  return `"${value.replace(/["\x5c]/g, " ").slice(0, 200)}"`;
}
