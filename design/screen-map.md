# Screen map: existing app → reference

Which route renders which reference screen, and where the data comes from. Written before
the redesign started; "new" means the route doesn't exist yet.

| Reference | Route | Today | Data / logic it wires to |
| --- | --- | --- | --- |
| 01-landing | `/` | `app/page.tsx` (sky hero draft) | static; "Launch app" → `/workspace` |
| 02-auth | `/sign-in`, `/sign-up` | `app/(auth)/*` | NextAuth GitHub + Google (`lib/auth.ts`) |
| 03-home | `/workspace` | `app/workspace/page.tsx` | agents + recent conversations (Drizzle) |
| 04-home-profile-menu | profile button in sidebar | `AppSidebar` footer (no menu yet) | `useSession`, `signOut` |
| 05-chat-empty | `/workspace/agent/[id]` (no messages) | `AgentChat` | `POST /api/agents/[id]/chat` (NDJSON stream) |
| 06-chat-messages | `/workspace/agent/[id]` | `AgentChat` + `Markdown` + `ApprovalCard` | same; approvals `POST /api/approvals/[id]` |
| 07-chat-config-instructions | config drawer, tab 1 | `AgentConfigPanel` "General" (`AgentFields`) | `updateAgent(…, { stay: true })` |
| 08-chat-config-tools | config drawer, tab 2 | `AgentTools` | `agent_tools`, `listToolSettings`, `listConnections` |
| 09-chat-config-schedule | config drawer, tab 3 | `AgentTasks` (compact) | `tasks` table, `saveTask`/`toggleTask`/`runTaskNow` |
| 10-chat-config-settings | config drawer, tab 4 | `DeleteAgent` + link to settings page | `deleteAgent` |
| 11-create-agent | `/workspace/create-agent` | `app/workspace/create-agent/page.tsx` + `AgentFields` | `createAgent` server action |
| 19-success | new: `/workspace/agent/[id]/created` | (createAgent redirects straight to chat) | the new agent row |
| 12-agents | new: `/workspace/agents` | — (agents only listed on Home/sidebar) | agents + task/run counts |
| 20-empty-agents | `/workspace/agents` with no agents | — | — |
| 13-live-run | `/workspace/agent/[id]/runs/[runId]` | `RunTimeline` | `runs` + `run_steps` (`getRunDetail`) |
| 14-inbox | `/workspace/inbox` | `Inbox` | `notifications`, approvals in tasks |
| 15-integrations | new: `/workspace/integrations` (old `/workspace/connections` redirects) | `Connections` | `connections`, Gmail OAuth start/callback |
| 16-marketplace | new: `/workspace/marketplace` | — (sidebar link 404s) | none yet → mock data |
| 17-usage-billing | new: `/workspace/usage` | — | runs per day (real) + plan/billing (mock) |
| 18-settings | new: `/workspace/settings` | — (only per-agent settings exist) | session user; preferences mock |

Not in the reference, restyled with the shared components rather than redesigned:
`/workspace/agent/[id]/settings`, `/workspace/agent/[id]/tasks`, `/workspace/agent/[id]/runs`.
Workspaces and Search are new sidebar entries with no backend.

## After the redesign

All 20 screens are built. What is real and what is mock (everything mock is in
`lib/mock-data.ts`; search the code for `TODO(backend)`):

| Screen | Mock parts |
| --- | --- |
| Shell | plan name ("Free plan"); token usage is real, the 100K allowance is `MOCK_PLAN` |
| Chat drawer → Settings | Isolated VM, Remember past chats (`MOCK_AGENT_SETTINGS`, disabled) |
| Chat drawer → Schedule | "Once" (disabled: one-off runs need backend) |
| Create agent | File analysis, Code execution, Multi-modal, Custom tools (coming soon) |
| Live run | Pause, Stop, steering (disabled) |
| Inbox | none — `?preview=sample` shows `MOCK_INBOX_ITEMS` in development |
| Integrations | Gmail, Notion, Jira and Slack are real (Slack needs a Slack app, D48); Drive, Calendar, GitHub and Discord are still `MOCK_INTEGRATIONS` |
| Marketplace | all templates (`MOCK_TEMPLATES`); "Use template" → real Create agent |
| Usage & billing | plan, limits, plans, invoices (`MOCK_PLAN`, `MOCK_PLANS`, `MOCK_INVOICES`) |
| Settings | photo, timezone, API keys, notifications (`MOCK_API_KEYS`, `MOCK_NOTIFICATION_PREFS`) |
| Workspaces | the page itself (`MOCK_WORKSPACES`) |
| Auth | email sign-in (no provider) |

## Visual comparison

With `npm run dev` running:

```sh
npm run compare:all                 # every screen, 1440 + 390, light + dark
npm run compare:all -- 06 07        # just some references
npm run compare -- /workspace 03-home              # one route against one reference
npm run compare -- /workspace 03-home --widths 390 --themes dark
```

Side-by-side PNGs land in `design/compare/` (git-ignored). Signed-in pages use a session
minted from `.env` (`NEXTAUTH_SECRET`); nothing in the app's auth changed for it.
