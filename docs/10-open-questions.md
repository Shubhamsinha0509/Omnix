# 10. Open questions

Decide these before the phase listed. When decided, record the answer in [decisions](09-decisions.md) and remove it from here.

Already decided: individuals only (D14), E2B for VMs (D15), Vercel hosting (D16), GitHub + Google sign-in (D18), approvals off-switch limited to `write` tools (D29), default model (D34), how a chat approval pauses and resumes (D35), how tasks are scheduled (D40), how a background run stays durable and waits for approval (D41), in-app delivery (D42), how long run logs are kept (D43), the email provider (D44) and the caps on unattended work (D45). MCP-first integrations is confirmed (D17 → D46), with the official SDK as the client (D47), a per-server registration mode (D48) and an allow-list only (D49).

## Product

| Question | Why it matters | Decide before |
|---|---|---|
| Who is the first target user? (e.g. founders, support teams, developers) | Decides which integrations and templates come first | Phase 5 |
| Pricing model: free tier + paid plans? Per agent, per run, or usage-based? | VMs and model tokens cost real money; limits must match pricing | Phase 7 |

## Integrations

| Question | Why it matters | Decide before |
|---|---|---|
| ~~Confirm MCP-first (D17)~~ | — | **Answered** by the Phase 5 spike: all three have official remote servers with OAuth (D46) |
| Fallback for apps without a good MCP server: build ourselves, or an integration platform? | Only matters for apps MCP doesn't cover | **Still open, not yet needed** — none of Slack, Notion or Jira needs it. Decide when an app users want turns out to have no usable server |
| Which apps after Gmail, Slack, Notion, Jira? | Roadmap focus | Phase 5 |
| ~~Can users add their own MCP server URLs, or only our allow-list?~~ | — | **Answered**: allow-list only (D49); user-supplied URLs stay in "Later" |
| Does Slack get a Marketplace-published Omnix app, or does each workspace use its own internal app? | Slack's MCP server refuses dynamic registration and bans unlisted apps (D48), so without one of these two, Slack cannot be connected at all — unlike Notion and Jira, which need no configuration | Before Slack ships |

## Infrastructure

| Question | Why it matters | Decide before |
|---|---|---|
| Can VM agents access the internet freely, or only allow-listed sites? | Security vs usefulness | Phase 6 |
| Do we let users pick the model per agent? | The default is decided (`deepseek/deepseek-chat-v3.1`, D34) and set in one place. A per-agent `model` column is still planned: cheap to offer, but someone has to own the cost of an agent switched to an expensive model | Phase 7 |
| What is the monthly OpenRouter budget, and what happens at the limit? | Tokens and per-search `web.search` charges both draw on account credit; a 402 currently just surfaces as an error message. **Partly answered:** D45 caps unattended work (4 runs an hour per task, 20 tasks an agent, 50 background runs a day per user) so a schedule cannot drain the account while this is undecided — but nothing yet watches actual spend, and a 402 mid-task still just fails that run | Phase 7 (with usage tracking) |
| Vercel plan (Hobby vs Pro)? | Function duration limits and commercial-use terms | Before deploying |

## Security and privacy

| Question | Why it matters | Decide before |
|---|---|---|
| Budget and timeline for Google's restricted-scope verification (CASA)? | Blocks public Gmail access | Before launch |
