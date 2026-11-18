# 6. Virtual machines (agent sandboxes)

Omnix's special feature: an agent can run on **its own isolated virtual machine**. Status: **Proposed**.

## Why an agent would need a VM

Most tasks don't. Reading Gmail and posting to Slack are API calls that run fine on our server. A VM is for agents that need to:

- **Run code** — analyse a CSV, generate a chart, transform data.
- **Use a real browser** — sites without an API, filling forms, taking screenshots.
- **Work with files** — keep a workspace of documents between runs.
- **Install software** — CLI tools, libraries.

Running this on our own server would be unsafe: one user's agent could read another's data or attack our infrastructure. A VM per agent isolates it.

## Approach — **Proposed**

**Use a sandbox provider, not our own VM fleet.** Managing VMs ourselves (images, networking, isolation, scaling, billing) is a company-sized project. Providers built for AI agents start an isolated microVM in about a second, can pause and resume it with its disk intact, and bill per second.

**Decided: [E2B](https://e2b.dev)** (decision D15) — sandboxes built for AI agents, fast start, pause/resume with persistent disk, TypeScript SDK, and it works from Vercel serverless functions because the VM runs on E2B's side.

At the start of Phase 6, confirm against our needs: browser support (headless Chrome in a custom template), network controls (allow-lists), pause/resume limits, pricing per hour, data region.

E2B sandboxes are also where we run any **local (stdio) MCP servers** an agent needs, since Vercel can't host them ([integrations](05-integrations.md#mcp-rules)).

## How it fits the runtime

- Agent setting: **Runtime → Shared (default) / Dedicated VM**.
- Tools marked `runsIn: "sandbox"` (`sandbox.run_code`, `sandbox.browser`, `sandbox.files`) are only offered to agents with a VM.
- The agent loop itself still runs on our server/Inngest; only the sandbox tools execute inside the VM. Simpler and cheaper than running the whole loop inside the VM.

## Lifecycle

```
first sandbox tool call ──► create VM (or resume if paused) ──► run tool
                                     │
                    idle for N minutes ──► pause (disk kept, no compute cost)
                    agent deleted / VM turned off ──► destroy VM and its data
```

- Track each agent's VM in the `sandboxes` table.
- Record `vm_seconds` per run for usage limits and billing.

## Safety rules

- **Never** put the user's OAuth tokens or our API keys inside the VM. The VM only gets what a specific tool call needs.
- Restrict outbound network by default; allow-list per agent where the provider supports it.
- Hard timeouts on every command; CPU/memory limits.
- VM data is the user's data: it must be deleted when they delete the agent or their account.

## Costs to plan for

VM time is the most expensive resource in the product. Plans need a VM-minutes allowance, and idle VMs must pause quickly.
