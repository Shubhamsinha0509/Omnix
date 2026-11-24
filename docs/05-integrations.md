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

Step one of Phase 5 was to confirm Slack, Notion and Jira have usable official remote MCP
servers with OAuth. They do — [the spike](#the-phase-5-spike-22-november-2026) records what
each one actually answered, and the one constraint that changes the plan.

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

## The Phase 5 spike (22 November 2026)

All three apps ship an official remote MCP server over Streamable HTTP, and all three are
proper OAuth 2.1 resource servers: an unauthenticated `tools/list` comes back `401` with a
`WWW-Authenticate: Bearer resource_metadata="…"` challenge, and the metadata it points at
names the authorization server. So D17 holds — see [D46](09-decisions.md). What the probes
returned, verbatim enough to build against:

| | Slack | Notion | Atlassian (Jira) |
|---|---|---|---|
| MCP endpoint | `https://mcp.slack.com/mcp` | `https://mcp.notion.com/mcp` | `https://mcp.atlassian.com/v2/mcp` |
| Protected resource metadata | `/.well-known/oauth-protected-resource` | same, and path-scoped per resource | path-scoped: `/.well-known/oauth-protected-resource/v2/mcp` |
| Authorization server | itself (`mcp.slack.com`) | itself (`mcp.notion.com`) | `auth.atlassian.com/VCeDsk8…` |
| Dynamic client registration | **no** | yes (`/register`) | yes (`/dcr/register`) |
| Client ID Metadata Documents | no | yes | yes |
| PKCE | S256 | S256 | S256 |
| Refresh tokens | `refresh_token` grant | `refresh_token` grant | `refresh_token` grant + `offline_access` scope |
| `iss` in the callback (RFC 9207) | not advertised | advertised | not advertised |
| Scopes | 30, granular (`channels:history`, `chat:write`, `search:read.public`…) | one: `default` | ~40, granular (`read:jira:agent-interface`, `write:confluence:agent-interface`…) |
| Status | GA | **Beta** ("Notion MCP (Beta)") | GA |

### The one constraint that changes the plan: Slack

Slack is the only one of the three that **will not register a client dynamically**. Its
authorization server metadata offers `client_secret_post` and no `registration_endpoint`,
and its docs are explicit that *only apps published in the Slack Marketplace, or a
workspace's own internal app, may use MCP at all* — an unlisted app is prohibited, and a
workspace admin has to approve it either way. Tokens are **user** tokens, not bot tokens.

So Slack costs what Gmail cost: a registered app, credentials in the environment
(`SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`), and a review before anyone outside a single
workspace can use it. Notion and Jira cost nothing to configure — the server hands us a
`client_id` on first connect and the user signs in.

That is why the allow-list carries a per-server registration mode rather than assuming
every server registers itself ([D48](09-decisions.md)), and why Slack connects last.

### Notion

One coarse scope (`default`) and no scope choices to make, which cuts both ways: nothing to
get wrong at connect time, and nothing to narrow either — a connected Notion account is as
broad as the pages the user shares with the integration during Notion's own consent step.
Its access control is on Notion's side, not ours. The server is still labelled Beta.

### Atlassian (Jira)

Its PRM is path-scoped, so the discovery URL carries the `/v2/mcp` path — a client that only
looks at the origin finds a `404`. Its CORS headers still expose `Mcp-Session-Id`, which
means it speaks a **2025-era** revision with sessions rather than the stateless 2026-07-28
shape; that is handled by negotiating the era rather than by special-casing Atlassian
([D47](09-decisions.md)). The scope list covers far more than Jira (Confluence, Bitbucket,
Loom, goals, assets…), so we ask only for the Jira and search scopes we use.

### What the spike did not settle

- **Nobody has held a token yet.** The 401 challenges, the metadata and the scope lists are
  real; the tool lists are not — ours come from `tools/list` at runtime, so what each server
  actually offers is read live rather than written down here. Nothing about a live
  `tools/call` is proven.
- **Jira's eligibility rules.** Slack's are documented and strict; Atlassian's product
  editions and admin-approval requirements were not confirmed from a primary source.
- **The fallback question** (own code, or an integration platform, for apps with no good
  server) stays open, because none of the three apps needs it.

Each app also has a direct API, which still matters for two things MCP does not cover:
webhooks for event triggers, and the fallback if a server is withdrawn.

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
