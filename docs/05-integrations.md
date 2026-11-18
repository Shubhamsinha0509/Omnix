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

1. **Gmail built in-house (Phase 3).** It's the flagship use case; building it end to end teaches us the whole flow (OAuth, encrypted tokens, refresh, tools, approvals) and gives us full control over the riskiest action, sending email.
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

### Gmail

- Use the Gmail API with the narrowest scopes possible. Reading mail needs `gmail.readonly` (or `gmail.modify` to label/archive); sending needs `gmail.send`.
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

## Connections UI

- **Connections page:** list connected accounts, status (active / needs reconnect), connect / disconnect.
- **Agent settings → Tools:** choose which tools this agent may use and with which connection; per-tool "require approval" switch.
- Disconnecting revokes the token with the provider and disables dependent tools.
