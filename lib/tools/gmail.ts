import { ConnectionError, type ToolAuth } from "@/lib/integrations/access";
import {
  GMAIL_LIMITS,
  GmailError,
  createDraft,
  findRecentlySent,
  getMessage,
  normaliseAddress,
  searchMessages,
  sendMessage,
  type Compose,
} from "@/lib/integrations/gmail";
import { SCOPE_COMPOSE, SCOPE_READ } from "@/lib/integrations/google";
import type { ApprovalSummary, JsonSchema, ToolContext, ToolDefinition, ToolResult } from "./types";

/**
 * The Gmail tools: search, read, draft, send.
 *
 * Two things shape every one of them. The results are **untrusted** — email is written by
 * strangers, and an agent that reads a mailbox is exactly what a prompt injection aims at
 * (docs/07-security.md) — so the read tools are marked `untrustedOutput` and the runner
 * labels what they return as data. And the write tools describe themselves in plain
 * English through `summarise`, because an approval card has to show the real recipient and
 * the real body, not the agent's account of them.
 */

/** Gmail's query language is the whole point of the search tool, so the model is taught it. */
const QUERY_HELP =
  "Gmail search query, the same syntax as the Gmail search box. " +
  'Examples: "is:unread", "is:unread in:inbox newer_than:2d", "from:anna@client.com has:attachment", ' +
  '"subject:invoice after:2026/11/01". Combine terms with spaces (AND) or OR.';

export const gmailSearch: ToolDefinition = {
  key: "gmail.search",
  label: "Searching email",
  description:
    "Search the user's Gmail mailbox and return a list of matching messages with sender, subject, " +
    "date and a one-line preview. Use this first to find messages, then `gmail.read` for the full " +
    "text of the ones that matter. Previews are short on purpose — don't summarise a message from " +
    "its preview alone if the detail matters.",
  risk: "read",
  provider: "gmail",
  runsIn: "server",
  untrustedOutput: true,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: QUERY_HELP, maxLength: 500 },
      maxResults: {
        type: "integer",
        description: `How many messages to return. Default ${GMAIL_LIMITS.defaultSearchResults}, maximum ${GMAIL_LIMITS.maxSearchResults}.`,
        minimum: 1,
        maximum: GMAIL_LIMITS.maxSearchResults,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    return withGmail(ctx, SCOPE_READ, async (auth) => {
      const found = await searchMessages(auth, {
        query: String(args.query).trim(),
        maxResults: typeof args.maxResults === "number" ? args.maxResults : GMAIL_LIMITS.defaultSearchResults,
        signal: ctx.signal,
      });

      return {
        output: {
          account: auth.accountLabel,
          query: args.query,
          returned: found.messages.length,
          estimatedTotal: found.estimatedTotal,
          messages: found.messages,
        },
      };
    });
  },
};

export const gmailRead: ToolDefinition = {
  key: "gmail.read",
  label: "Reading email",
  description:
    "Read one Gmail message in full by its id, which comes from `gmail.search`. Returns the headers, " +
    "the body as plain text and a list of attachments (their names and sizes — attachments are not " +
    "downloaded). Also returns `threadId` and `messageIdHeader`, which `gmail.create_draft` and " +
    "`gmail.send` need in order to reply in the same thread.",
  risk: "read",
  provider: "gmail",
  runsIn: "server",
  untrustedOutput: true,
  parameters: {
    type: "object",
    properties: {
      messageId: {
        type: "string",
        description: "The message id from a `gmail.search` result.",
        maxLength: 128,
      },
      maxChars: {
        type: "integer",
        description: `How much of the body to return. Default ${GMAIL_LIMITS.defaultBodyChars}, maximum ${GMAIL_LIMITS.maxBodyChars}.`,
        minimum: 200,
        maximum: GMAIL_LIMITS.maxBodyChars,
      },
    },
    required: ["messageId"],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    return withGmail(ctx, SCOPE_READ, async (auth) => {
      const id = String(args.messageId).trim();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
        return { error: "That isn't a valid message id. Use one from a `gmail.search` result." };
      }

      const message = await getMessage(auth, {
        id,
        maxChars: typeof args.maxChars === "number" ? args.maxChars : GMAIL_LIMITS.defaultBodyChars,
        signal: ctx.signal,
      });
      return { output: { account: auth.accountLabel, message } };
    });
  },
};

/** The fields both write tools take. Shared so a draft and a send can't drift apart. */
const COMPOSE_PARAMETERS: JsonSchema = {
  type: "object",
  properties: {
    to: {
      type: "array",
      description: 'Recipients, as "name@example.com" or "Name <name@example.com>".',
      items: { type: "string", maxLength: 320 },
      maxItems: GMAIL_LIMITS.maxRecipients,
    },
    cc: {
      type: "array",
      description: "Carbon-copy recipients.",
      items: { type: "string", maxLength: 320 },
      maxItems: GMAIL_LIMITS.maxRecipients,
    },
    subject: { type: "string", description: "The subject line.", maxLength: GMAIL_LIMITS.maxSubjectChars },
    body: {
      type: "string",
      description:
        "The message, as plain text. Write it in full — the user sees exactly this before approving. " +
        "Blank lines separate paragraphs; there is no HTML.",
      maxLength: GMAIL_LIMITS.maxComposeBodyChars,
    },
    threadId: {
      type: "string",
      description: "To reply inside an existing thread: the `threadId` from `gmail.read`.",
      maxLength: 128,
    },
    inReplyTo: {
      type: "string",
      description:
        "When replying, the `messageIdHeader` from `gmail.read`, so mail clients thread it correctly.",
      maxLength: 400,
    },
  },
  required: ["to", "subject", "body"],
  additionalProperties: false,
};

export const gmailCreateDraft: ToolDefinition = {
  key: "gmail.create_draft",
  label: "Writing a draft",
  description:
    "Save a draft email in the user's Gmail. Nothing is sent: the draft waits in their Drafts folder " +
    "for them to read, change and send themselves. Prefer this over `gmail.send` whenever the user " +
    "hasn't clearly asked for the email to go out.",
  risk: "write",
  provider: "gmail",
  runsIn: "server",
  parameters: COMPOSE_PARAMETERS,
  summarise: (args) => summariseCompose(args, "Save a draft email"),
  async execute(ctx, args) {
    return withGmail(ctx, SCOPE_COMPOSE, async (auth) => {
      const compose = readCompose(args);
      if ("error" in compose) return compose;

      const draft = await createDraft(auth, compose.value, ctx.signal);
      return {
        output: {
          saved: true,
          account: auth.accountLabel,
          draftId: draft.draftId,
          to: compose.value.to,
          subject: compose.value.subject,
        },
      };
    });
  },
};

export const gmailSend: ToolDefinition = {
  key: "gmail.send",
  label: "Sending email",
  description:
    "Send an email from the user's Gmail account. This leaves their mailbox and cannot be taken back, " +
    "so only use it when the user has asked for the email to be sent. The user approves the exact " +
    "recipient, subject and body first unless they have turned that off. If you are not sure, use " +
    "`gmail.create_draft` instead.",
  // `write`, not `destructive`: sending is irreversible but it is also the whole point of
  // the feature, so a user may deliberately trust this tool on one agent (D29). Nothing
  // here is destructive — a tool that deleted mail could never have approval turned off.
  risk: "write",
  provider: "gmail",
  runsIn: "server",
  parameters: COMPOSE_PARAMETERS,
  summarise: (args) => summariseCompose(args, "Send an email"),
  async execute(ctx, args) {
    return withGmail(ctx, SCOPE_COMPOSE, async (auth) => {
      const compose = readCompose(args);
      if ("error" in compose) return compose;

      // A background run that died after sending will try again (docs/04-agent-runtime.md).
      // Check Sent first so the recipient doesn't get the same email twice.
      const already = await findRecentlySent(auth, compose.value, ctx.signal);
      if (already) {
        return {
          output: {
            sent: true,
            alreadySent: true,
            account: auth.accountLabel,
            messageId: already.id,
            note: "This email had already been sent, so it was not sent again.",
          },
        };
      }

      const sent = await sendMessage(auth, compose.value, ctx.signal);
      return {
        output: {
          sent: true,
          account: auth.accountLabel,
          messageId: sent.messageId,
          to: compose.value.to,
          subject: compose.value.subject,
        },
      };
    });
  },
};

export const GMAIL_TOOLS = [gmailSearch, gmailRead, gmailCreateDraft, gmailSend];

// ----------------------------------------------------------------------------- helpers

/**
 * Runs the body with a usable Gmail connection, or returns an error the model can read.
 *
 * Every failure a tool can hit on the way to Gmail is turned into words here: no account
 * connected, a permission the user didn't grant, a mailbox that answered 429. The model
 * gets to say what went wrong and carry on, instead of the run dying.
 */
async function withGmail(
  ctx: ToolContext,
  scope: string,
  body: (auth: ToolAuth) => Promise<ToolResult>,
): Promise<ToolResult> {
  const auth = ctx.auth;
  if (!auth) {
    return {
      error:
        "No Gmail account is connected for this tool. Ask the user to connect Gmail on the " +
        "Connections page and enable it for this agent in its settings.",
    };
  }
  if (!auth.hasScope(scope)) {
    return {
      error:
        `The connection to ${auth.accountLabel} doesn't include the permission this needs. ` +
        "Ask the user to reconnect Gmail and approve every box.",
    };
  }

  try {
    return await body(auth);
  } catch (error) {
    if (error instanceof ConnectionError) return { error: error.message };
    if (error instanceof GmailError) return { error: describeGmailError(error) };
    throw error;
  }
}

function describeGmailError(error: GmailError) {
  switch (error.status) {
    case 0:
      return error.message;
    case 400:
      return `Gmail rejected that: ${error.message}`;
    case 404:
      return "That message no longer exists in the mailbox.";
    case 429:
      return "Gmail is rate limiting this account. Wait a moment before trying again.";
    default:
      return error.status >= 500
        ? "Gmail had a temporary problem. Try again in a moment."
        : `Gmail returned an error (${error.status}): ${error.message}`;
  }
}

/**
 * Checks the fields of an outgoing email.
 *
 * Note what isn't here: `bcc`. An agent that can blind-copy an address nobody sees is a
 * quiet way to forward a mailbox elsewhere, and the approval card is only a defence if it
 * shows every recipient. If a real use for it turns up, it needs to be visible on the card.
 */
function readCompose(args: Record<string, unknown>): { value: Compose } | { error: string } {
  const to = addresses(args.to);
  const cc = addresses(args.cc);
  if ("error" in to) return to;
  if ("error" in cc) return cc;

  if (to.value.length === 0) return { error: "An email needs at least one recipient in `to`." };
  if (to.value.length + cc.value.length > GMAIL_LIMITS.maxRecipients) {
    return { error: `One email can go to at most ${GMAIL_LIMITS.maxRecipients} recipients.` };
  }

  const subject = typeof args.subject === "string" ? args.subject.trim() : "";
  const body = typeof args.body === "string" ? args.body.trim() : "";
  if (!subject) return { error: "An email needs a subject." };
  if (!body) return { error: "The email body is empty. Write the message the user should see." };

  return {
    value: {
      to: to.value,
      ...(cc.value.length > 0 ? { cc: cc.value } : {}),
      subject,
      body,
      ...(typeof args.threadId === "string" && args.threadId.trim()
        ? { threadId: args.threadId.trim() }
        : {}),
      ...(typeof args.inReplyTo === "string" && args.inReplyTo.trim()
        ? { inReplyTo: args.inReplyTo.trim() }
        : {}),
    },
  };
}

/** Validates a list of recipients up front, so a bad one is caught before anything is sent. */
function addresses(raw: unknown): { value: string[] } | { error: string } {
  if (raw === undefined || raw === null) return { value: [] };
  const list = Array.isArray(raw) ? raw : [raw];
  const value: string[] = [];

  for (const entry of list) {
    if (typeof entry !== "string" || !entry.trim()) continue;
    try {
      value.push(normaliseAddress(entry));
    } catch (error) {
      return { error: (error as Error).message };
    }
  }
  return { value };
}

/**
 * The approval card's text. It shows the real recipient, subject and body — the user is
 * agreeing to *this*, not to the agent's summary of it (docs/07-security.md).
 */
function summariseCompose(args: Record<string, unknown>, verb: string): ApprovalSummary {
  const to = Array.isArray(args.to) ? args.to.filter((entry) => typeof entry === "string") : [];
  const cc = Array.isArray(args.cc) ? args.cc.filter((entry) => typeof entry === "string") : [];
  const subject = typeof args.subject === "string" ? args.subject : "";
  const body = typeof args.body === "string" ? args.body : "";

  const recipients = to.join(", ") || "nobody";
  const details = [
    { label: "To", value: recipients },
    ...(cc.length > 0 ? [{ label: "Cc", value: cc.join(", ") }] : []),
    { label: "Subject", value: subject || "(no subject)" },
    { label: "Message", value: body },
    ...(args.threadId ? [{ label: "Thread", value: "Replies inside an existing conversation" }] : []),
  ];

  return { summary: `${verb} to ${recipients}`, details };
}
