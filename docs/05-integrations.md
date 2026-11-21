# 5. Integrations

How agents get access to Gmail, Slack, Notion, Jira and more.

## What every integration needs

1. **Connect flow (OAuth)** — user clicks "Connect Gmail", approves on Google's page, comes back connected.
2. **Token storage** — save, encrypt, refresh before expiry, handle revocation.
3. **API client** — the actual calls (search email, post message, create issue).
4. **Tools** — model-friendly wrappers around those calls (see [agent runtime](04-agent-runtime.md#tools)).
5. **Events (optional)** — webhooks so tasks can trigger on "new email", "new Jira issue".
6. **App review** — many providers require approval before public launch.

## Options

| Option | How it works | Pros | Cons |
|---|---|---|---|
| **A. Build each ourselves** | Our own OAuth app per provider, our own API code | Full control, no extra vendor, no per-connection fees | Weeks per provider; we own token refresh, rate limits, API changes, app reviews |
| **B. Integration platform** (e.g. Composio, Nango, Pipedream Connect, Arcade) | They host OAuth + tokens and expose ready-made tools/APIs; we call them | Hundreds of apps quickly; token handling done for us | Vendor cost and lock-in; less control; another place user data passes through |
| **C. MCP servers** | Connect to Model Context Protocol servers that expose tools | Open standard, growing ecosystem, lets users add their own | Quality varies; auth story still maturing; we still need a UI and permissions around it |

## Approach — MCP-first (**Proposed**, decision D17)

1. **Gmail built in-house (Phase 3 — built).** It's the flagship use case; building it end to end teaches us the whole flow (OAuth, encrypted tokens, refresh, tools, approvals) and gives us full control over the riskiest action, sending email.
2. **Everything else through remote MCP servers (Phase 5).** Omnix's agent runner acts as an **MCP client**. For each supported app we use its official (or vetted) **remote MCP server over HTTP**; the user connects it once via the server's OAuth flow and its tools become available to their agents.
3. **Fallback** for apps without a good MCP server: build the integration ourselves, or use an integration platform for just those apps. (**Open** — see [open questions](10-open-questions.md#integrations).)

Our tool registry hides where a tool comes from (built-in or MCP), so we can swap an app's source later without changing agents.

### MCP rules

| Rule | Why |
|---|---|
| **Remote (HTTP) servers only on our backend** | We host on Vercel (D16): serverless functions can't keep local `stdio` server processes running. If an app only ships a local server, run it inside the agent's **E2B sandbox** instead |
| **Allow-list of servers** — official or vetted; users pick from a catalog | Quality varies, and a malicious server can hide instructions in its tool descriptions ("tool poisoning") |
| **Per-user OAuth per server**, tokens encrypted in `connections` | Same security model as Gmail ([security](07-security.md#secrets)) |
| **Approval by default for every MCP tool** unless *we* mark it read-only | MCP tool hints like "read-only" or "destructive" come from the server and can't be fully trusted |
| **Show the source** — every tool in the UI shows which server it comes from | Users understand what the agent can touch |
| **Cache tool lists, refresh periodically**; never let the model see raw credentials | Performance and safety |

Step one of Phase 5: confirm Slack, Notion and Jira have usable official remote MCP servers with OAuth, and record the result.

## Priority order — **Proposed**

1. Gmail (read, search, draft, send-with-approval)
2. Slack (post message, read channel, DM — also a delivery channel for task results)
3. Notion (search, read page, create/update page)
4. Jira (search issues, create/update issue, comment)
5. Google Calendar, Google Drive, GitHub, Linear… (by user demand)

## Provider notes

### Gmail — **built** (Phase 3)

`lib/integrations/google.ts` (OAuth), `lib/integrations/gmail.ts` (the API),
`lib/tools/gmail.ts` (the four tools), `app/api/connections/gmail/` (connect and callback).

- **Scopes asked for:** `gmail.readonly` and `gmail.compose`, and nothing else.
  `gmail.compose` covers drafts *and* sending, so no separate `gmail.send` is needed, and
  `gmail.modify` is not asked for while labelling and archiving aren't tools. Google lets
  people untick a box, so each tool checks the scopes it needs at call time and says what
  to reconnect rather than failing with a 403.
- **Written over `fetch`, not `googleapis`:** four endpoints don't justify the dependency,
  and the parts that need care — real-world MIME, and building an outgoing message without
  letting the model inject headers — are ours either way
  ([security](07-security.md#sending-email-the-model-composed)).
- **Reading:** `gmail.search` takes Gmail's own query syntax (`is:unread newer_than:2d`),
  which the model is taught in the tool description. Gmail's list endpoint returns ids
  only, so each hit costs a second request for its headers — hence a result cap and a
  little parallelism. `gmail.read` walks the MIME tree, prefers `text/plain`, flattens
  HTML where there is no plain part, and lists attachments without downloading them.
- Both read tools are marked `untrustedOutput`: email is the most likely place an
  instruction aimed at the agent is hiding.
- These are Google **restricted scopes**: fine for up to 100 test users in development, but public launch requires Google OAuth app verification **and an annual third-party security assessment (CASA)** — costs money and takes weeks. Plan it early. See [security](07-security.md#google-verification).
- "New email" events: Gmail push notifications via Google Cloud Pub/Sub → our webhook → Inngest event.
- Note: this is a **separate** OAuth flow from "Sign in with Google". Signing in proves who the user is; connecting Gmail grants the agent access to their mailbox.

### Slack

- Slack app with OAuth (bot token + optionally user token). Public distribution requires Slack App Directory review if listed.
- Events API for triggers ("message in channel").

### Notion

- Public integration with OAuth. The user picks which pages the integration can see.

### Jira (Atlassian)

- OAuth 2.0 (3LO) app; API access is per Atlassian site the user selects.

Notes for Slack, Notion and Jira above describe their direct APIs — relevant for events/webhooks and for the fallback. With MCP-first, their tools come from each app's MCP server.

## Connections UI — **built** (Phase 3)

- **Connections page** (`/workspace/integrations`): connected accounts with their status
  (active / expired / reconnect needed) and what each one may do, plus what is available to
  connect. Connecting is a plain link to a GET that redirects.
- **Agent settings → Tools:** every tool, grouped by where it comes from, with a switch
  per tool; an account picker when the user has more than one of that provider; and an
  "Ask me before this runs" switch on `write` tools only. Each control saves on change.
  A tool whose provider has no connected account is shown but disabled, with a link.
- Disconnecting revokes the grant with Google, deletes the row, and leaves dependent tools
  reading "needs an account" rather than quietly disappearing.

Connecting an account gives **no agent** access on its own — that is a second, per-agent
step, which is what makes least privilege real rather than aspirational.
