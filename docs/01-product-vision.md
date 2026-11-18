# 1. Product vision

## The idea

People repeat the same digital chores every day: triaging email, posting updates to Slack, keeping Notion and Jira in sync, researching and summarising. Omnix lets anyone create an **AI agent** for each chore, connect it to the apps it needs, and let it work — on demand, on a schedule, or when something happens.

**Special feature:** an agent can run on its own **virtual machine**, so it can do things a plain chatbot can't — run code, use a real browser, work with files — safely isolated from other users.

## Who it's for

**Decided: individuals** (decision D14) — power users who live in Gmail, Slack, Notion and Jira. Each person owns their own agents and connections. Team workspaces are not planned for v1.

## Core concepts

| Concept | Meaning | Example |
|---|---|---|
| **Agent** | A named AI worker with instructions, an avatar, a set of tools and a runtime | "Inbox Assistant" |
| **Instructions** | What the agent is for and how it behaves (its system prompt) | "Summarise unread emails. Flag anything from my manager." |
| **Connection** | A user's authorised account in an external app | "shubham@… Gmail" |
| **Tool** | One action an agent can take, usually through a connection | `gmail.search`, `slack.post_message` |
| **Task** | A job the agent runs, with a trigger | "Every weekday at 9:00, summarise yesterday's email and DM it to me on Slack" |
| **Trigger** | What starts a task | Manual, schedule (cron), event (new email, webhook) |
| **Run** | One execution of a task or chat turn, with a step-by-step log | Run #42: 3 tool calls, 1 approval, succeeded |
| **Approval** | A pause where the agent asks the user before a risky action | "Send this reply to the client? Approve / Reject" |
| **Runtime** | Where the agent's tools execute: shared server, or its own VM | "Dedicated VM" toggle |
| **Marketplace** | Ready-made agents users can copy | "Standup Summariser" template |

## User journeys we must support

1. **Chat with an agent** — ask it things, it uses tools to answer. *(Chat UI exists; tools are built — `time.now`, `web.fetch`, `web.search` — though `web.search` has not yet run successfully.)*
2. **Connect an app** — click "Connect Gmail", approve, done.
3. **Give an agent a task** — "Every morning at 9, summarise my inbox and send it to Slack."
4. **Review what it did** — see each run: what it read, what it decided, what it sent.
5. **Approve risky actions** — get notified, approve or reject, the agent continues.
6. **Turn on a dedicated VM** — for agents that need code, a browser or files.
7. **Start from the Marketplace** — copy a template agent, connect your own accounts.

## What "v1 launch" means

- Users can create agents, connect **Gmail + Slack + Notion + Jira** (at minimum), and schedule tasks.
- Every run is logged and every risky action needs approval by default.
- Usage limits stop runaway cost.
- Gmail access is approved by Google for public use (see [security](07-security.md#google-verification)).

## Out of scope for v1 (for now)

- Mobile apps.
- Agents talking to other agents (multi-agent handoffs) — planned later.
- Voice.
- Self-hosted / on-premise Omnix.
