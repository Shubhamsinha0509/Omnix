# 10. Open questions

Decide these before the phase listed. When decided, record the answer in [decisions](09-decisions.md) and remove it from here.

Already decided: individuals only (D14), E2B for VMs (D15), Vercel hosting (D16), GitHub + Google sign-in (D18), approvals off-switch limited to `write` tools (D29). MCP-first integrations is proposed (D17).

## Product

| Question | Why it matters | Decide before |
|---|---|---|
| Who is the first target user? (e.g. founders, support teams, developers) | Decides which integrations and templates come first | Phase 5 |
| Pricing model: free tier + paid plans? Per agent, per run, or usage-based? | VMs and model tokens cost real money; limits must match pricing | Phase 7 |

## Integrations

| Question | Why it matters | Decide before |
|---|---|---|
| Confirm MCP-first (D17) after checking that Slack, Notion and Jira have usable official remote MCP servers with OAuth | If a key app has no good server, we need the fallback for it | Phase 5 |
| Fallback for apps without a good MCP server: build ourselves, or an integration platform? | Only matters for apps MCP doesn't cover | Phase 5 |
| Which apps after Gmail, Slack, Notion, Jira? | Roadmap focus | Phase 5 |
| Can users add their own MCP server URLs, or only our allow-list? | Flexibility vs tool-poisoning risk | Phase 5 |

## Infrastructure

| Question | Why it matters | Decide before |
|---|---|---|
| Can VM agents access the internet freely, or only allow-listed sites? | Security vs usefulness | Phase 6 |
| Which OpenRouter model should be the default, and do we let users pick? | `deepseek/deepseek-chat-v3.1` is the current default (D26). 415 models support tool calling, and the data model already plans a per-agent `model` column — cheap to offer, but someone has to own the choice and the cost | Phase 3 |
| What is the monthly OpenRouter budget, and what happens at the limit? | Tokens and per-search `web.search` charges both draw on account credit; a 402 currently just surfaces as an error message | Phase 4 (before agents run unattended) |
| Vercel plan (Hobby vs Pro)? | Function duration limits and commercial-use terms | Before deploying |

## Security and privacy

| Question | Why it matters | Decide before |
|---|---|---|
| How long do we keep run logs that contain email/Slack content? | Privacy, storage cost | Phase 4 |
| Budget and timeline for Google's restricted-scope verification (CASA)? | Blocks public Gmail access | Before launch |
