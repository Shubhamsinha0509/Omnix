# 11. Diagrams

The code as it stands on `production-guards` (after D59), drawn in Mermaid. GitHub and
VS Code render these in place. Each diagram covers one idea; the numbered docs hold the
detail and the reasons.

1. [System overview](#1-system-overview): what talks to what
2. [Data model](#2-data-model): every table and how they connect
3. [A chat turn](#3-a-chat-turn): one message, including an approval
4. [A scheduled task](#4-a-scheduled-task): a background run, start to delivery
5. [One tool call](#5-one-tool-call): what the runner decides before a tool runs
6. [Run status](#6-run-status)
7. [VM lifecycle](#7-vm-lifecycle)
8. [Background sweeps](#8-background-sweeps)
9. [CI](#9-ci)

## 1. System overview

```mermaid
flowchart TB
    user(["User's browser"])

    subgraph app["Omnix: Next.js app"]
        direction TB
        subgraph routes["Pages and routes"]
            direction LR
            auth["Sign-in<br/>/api/auth (NextAuth)"]
            pages["Workspace pages<br/>app/workspace"]
            chat["Chat<br/>/api/agents/:id/chat"]
            approve["Approvals<br/>/api/approvals/:id"]
            conn["Connect accounts<br/>/api/connections"]
            files["Shared files<br/>/api/files/:id"]
            ingest["Background jobs<br/>/api/inngest (signed, D57)"]
        end
        runner["Agent runner<br/>lib/agent/runner.ts"]
        tools["Tools<br/>lib/tools: time, web, gmail, sandbox, MCP"]
        db[("Postgres (Neon)<br/>db/schema.ts, drizzle/")]
    end

    subgraph outside["Outside services"]
        direction LR
        openrouter["OpenRouter<br/>model + web search"]
        e2b["E2B<br/>one VM per agent"]
        google["Google<br/>sign-in + Gmail"]
        github["GitHub<br/>sign-in"]
        mcp["MCP servers<br/>Notion, Atlassian, ..."]
        inngest["Inngest<br/>cron, events, waits"]
        resend["Resend<br/>result email"]
    end

    user --> routes
    routes --> db
    chat & approve & ingest --> runner
    runner --> db
    runner --> openrouter
    runner --> tools
    tools --> e2b & google & mcp
    auth --> google & github
    conn --> google & mcp
    approve -. "approval/decided" .-> inngest
    inngest -. "cron + task runs" .-> ingest
    ingest --> resend
```

The runner is shared (D9): a chat message and a scheduled task go through the same loop,
limits and logging. Only how they wait for an approval differs (sections 3 and 4).

## 2. Data model

Every table belongs to a user, and deleting the user cascades to all of it (D56).
`mcp_clients` and `rate_limits` have no user link: clients are shared per issuer, and
rate limits are counters keyed by a string.

```mermaid
erDiagram
    users ||--o{ agents : owns
    users ||--o{ connections : "connects accounts"
    agents ||--o{ conversations : has
    conversations ||--o{ messages : holds
    agents ||--o{ agent_tools : "tool settings"
    connections |o--o{ agent_tools : "used by"
    agents ||--o{ tasks : "scheduled work"
    agents ||--o{ runs : executes
    conversations |o--o{ runs : "chat runs"
    tasks |o--o{ runs : "task runs"
    runs ||--o{ run_steps : "logged as"
    runs ||--o{ approvals : "asks for"
    run_steps |o--o| approvals : "step that asked"
    users ||--o{ notifications : receives
    approvals |o--o{ notifications : "approval request"
    agents ||--o| sandboxes : "one VM"
    users ||--o{ vm_usage : "VM time"
    connections ||--o| mcp_tool_cache : "tools/list cache"
    users ||--o{ mcp_oauth_flows : "consent in progress"
    agents ||--o{ shared_files : "hands over"
    runs |o--o{ shared_files : "made in"

    users {
        serial id PK
        text email UK
        text name
    }
    agents {
        uuid id PK
        int user_id FK
        text name
        text instructions
        text avatar_seed
    }
    conversations {
        uuid id PK
        uuid agent_id FK
        text title
        timestamptz busy_until
    }
    messages {
        uuid id PK
        uuid conversation_id FK
        text role "user | assistant"
        text content
    }
    connections {
        uuid id PK
        int user_id FK
        text provider
        text kind "builtin | mcp"
        text access_token_enc "encrypted"
        text refresh_token_enc "encrypted"
        text status "active | expired | revoked"
    }
    agent_tools {
        uuid agent_id PK,FK
        text tool PK
        boolean enabled
        uuid connection_id FK
        text approval "never | always"
    }
    tasks {
        uuid id PK
        uuid agent_id FK
        text prompt
        text trigger "manual | schedule"
        text schedule "cron"
        text_array deliver "inapp, email"
        timestamptz next_run_at
    }
    runs {
        uuid id PK
        uuid agent_id FK
        uuid conversation_id FK
        uuid task_id FK
        text trigger "chat | manual | schedule | event"
        text status
        int input_tokens
        int output_tokens
    }
    run_steps {
        uuid id PK
        uuid run_id FK
        int seq
        text type "model | tool_call | tool_result | approval | error"
        jsonb payload
    }
    approvals {
        uuid id PK
        uuid run_id FK
        uuid step_id FK
        text tool
        jsonb payload "the exact action"
        jsonb resume "chat state"
        text status "pending | approved | rejected | expired"
        timestamptz expires_at
    }
    notifications {
        uuid id PK
        int user_id FK
        text kind "task_result | task_failed | approval_request"
        uuid approval_id FK
        timestamptz read_at
    }
    sandboxes {
        uuid agent_id PK,FK
        text provider_id "E2B id"
        text status
        int used_seconds
    }
    vm_usage {
        uuid id PK
        int user_id FK
        int seconds
    }
    mcp_clients {
        text issuer PK
        text client_id
        text client_secret_enc
    }
    mcp_oauth_flows {
        text state PK
        int user_id FK
        text code_verifier_enc
    }
    mcp_tool_cache {
        uuid connection_id PK,FK
        jsonb tools
    }
    rate_limits {
        text key PK
        int count
        timestamptz expires_at
    }
    shared_files {
        uuid id PK
        uuid agent_id FK
        uuid run_id FK
        bytea data
    }
```

## 3. A chat turn

One request is one turn, with a deadline just inside the route's 300 s limit (D58). If the
agent asks for approval, the request ends there; the decision arrives as a **second**
request, which runs the stored action and lets the agent carry on (D35).

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant C as Chat route
    participant R as Runner
    participant DB as Postgres
    participant M as OpenRouter
    participant T as Tool
    participant A as Approval route

    U->>C: POST message
    C->>C: signed in? model key? model allowed in production? (D59) rate limit?
    C->>DB: claim conversation (busy_until), open run
    C->>R: runAgent, deadline = now + 300 s - margin
    loop until the model answers, or a limit is reached
        R->>M: stream one model turn
        M-->>U: reply text, streamed as NDJSON
        alt the model asked for tools
            R->>R: executeCall: arguments valid? egress guard? approval needed?
            alt runs without asking
                R->>T: call with the time left
                T-->>R: result, logged as run_steps
            else needs approval
                R->>DB: approval row with the exact payload and resume state
                R-->>U: approval card
                Note over C,R: the request ends: run is waiting_approval
            end
        end
    end
    R->>DB: save reply, finish run
    opt user decides on the card
        U->>A: POST approve or reject
        A->>DB: claimApproval (one conditional update: no double runs)
        A->>R: resumeAgent: run the stored action, or tell the model it was refused
        R-->>U: the rest of the turn, streamed
    end
```

When time runs short the runner skips tools it can no longer finish, keeps 40 s for a last
model turn, and ends with "Send continue" rather than being cut off (D58).

## 4. A scheduled task

Background runs live in Inngest, so waiting for an approval costs nothing: the run sleeps
on `step.waitForEvent` for up to 24 hours and carries on in the same run (D41). Each step
is its own request, so no request deadline applies.

```mermaid
sequenceDiagram
    autonumber
    participant S as Scheduler (cron, every minute)
    participant I as Inngest
    participant W as runTask
    participant R as Runner
    participant DB as Postgres
    actor U as User
    participant A as Approval route
    participant D as Delivery

    S->>DB: claim-due-tasks (next_run_at passed)
    S->>I: sendEvent agent/task.run, one per task
    I->>W: start run
    W->>DB: load-task, check-daily-limit, mark-task-started
    W->>R: runAgent, each model turn and tool call a durable step
    opt a tool needs approval
        R->>DB: approval row, run waiting_approval
        W->>DB: notify-approval, an inbox notification
        W->>I: waitForEvent approval/decided, up to 24 h
        U->>A: approve or reject
        A->>DB: claimApproval
        A->>I: send approval/decided
        I->>W: resume
        W->>R: act on the decision, then carry on
    end
    R->>DB: finish run
    W->>D: deliver-result
    D->>DB: in-app notification
    D-->>U: email via Resend, if the task asks for it
```

## 5. One tool call

`executeCall` in `lib/agent/runner.ts`. Nothing the model says is trusted: arguments are
checked, and an approved action runs the stored payload, not a fresh one.

```mermaid
flowchart TD
    start(["The model asks for a tool"]) --> budget{"Under the run's<br/>tool-call limit?"}
    budget -- no --> refuse1["Answer: limit reached"]
    budget -- yes --> time{"Enough time left<br/>to run it? (D58)"}
    time -- no --> refuse2["Answer: out of time<br/>then stop with 'Send continue'"]
    time -- yes --> known{"A tool this<br/>agent has?"}
    known -- no --> refuse3["Answer: no such tool"]
    known -- yes --> valid{"Arguments parse<br/>and validate?"}
    valid -- no --> refuse4["Answer: invalid arguments,<br/>the model may retry"]
    valid -- yes --> egress{"Egress guard (D54):<br/>could this send private<br/>data somewhere new?"}
    egress -- yes --> ask
    egress -- no --> setting{"Tool's approval<br/>setting"}
    setting -- always --> ask["Create an approval card<br/>with the exact payload"]
    setting -- never --> run["Run it, with the time left"]
    ask --> decision{"User decides"}
    decision -- approve --> stored["Run the stored payload"]
    decision -- "reject, or expire" --> told["Tell the model it wasn't run"]
    run --> result["Result, trimmed, wrapped as data<br/>and logged to run_steps"]
    stored --> result
```

## 6. Run status

`lib/agent/runs.ts` and the end of `drive` in the runner. Every run is created as
`running`; `queued` is in the schema but nothing sets it yet.

```mermaid
stateDiagram-v2
    direction TB
    [*] --> running : chat message or task
    running --> waiting_approval : tool needs approval
    waiting_approval --> running : decided
    waiting_approval --> failed : sweep, card expired
    running --> succeeded : answered, or time limit after some reply
    running --> cancelled : time limit before any reply, or aborted
    running --> failed : model or tool error, or sweep
    note right of waiting_approval
        A background run also carries on after
        its card expires: the agent is told no.
    end note
    succeeded --> [*]
    failed --> [*]
    cancelled --> [*]
```

## 7. VM lifecycle

`lib/sandbox`. Every change is a claim: one conditional update from the allowed states,
so two clicks make one VM. The in-between states (`starting`, `pausing`, `stopping`) are
held only while E2B is called.

```mermaid
stateDiagram-v2
    [*] --> stopped
    stopped --> starting : start, if VM time is left (D55)
    paused --> starting : start (resumes, files kept)
    error --> starting : start
    starting --> running : created or resumed
    starting --> error : E2B failed
    running --> pausing : pause
    pausing --> paused
    pausing --> stopped : already gone at E2B
    pausing --> running : pause failed
    running --> paused : idle timeout, or the monthly cap is reached
    running --> stopping : stop
    paused --> stopping : stop
    error --> stopping : stop
    stopping --> stopped : killed, files deleted
    running --> stopped : gone at E2B
```

## 8. Background sweeps

Every scheduled function in `lib/inngest`. `runTask` is the only one started by an event;
the rest run on a timer.

```mermaid
flowchart LR
    cron1(["every minute"]) --> sched["taskScheduler<br/>claim due tasks"] -- "agent/task.run" --> run["runTask<br/>section 4"]
    cron2(["every 10 min"]) --> stale["staleRunSweep<br/>close runs whose worker is gone,<br/>stop VMs past the cap"]
    cron3(["hourly, :20"]) --> mcp["mcpToolSweep<br/>refresh MCP tool lists,<br/>purge abandoned consents"]
    cron4(["daily, 04:10"]) --> ret["retentionSweep (D43)<br/>forget old step payloads,<br/>notifications, shared files,<br/>rate-limit counters"]
```

## 9. CI

`.github/workflows/ci.yml` (D59): two jobs in parallel on every pull request and every push
to `main`. No secrets; nothing calls a real model, VM or account.

```mermaid
flowchart LR
    trigger(["Pull request,<br/>or push to main"]) --> checks & database

    subgraph checks["checks"]
        direction TB
        c1["npm ci"] --> c2["lint"] --> c3["typecheck"] --> c4["next build"] --> c5["verify:model"] --> c6["verify:inngest"]
    end

    subgraph database["database (Postgres 17)"]
        direction TB
        d1["npm ci"] --> d2["throwaway<br/>encryption key"] --> d3["db:migrate<br/>from drizzle/"] --> d4["seed one user"] --> d5["verify: egress, limits,<br/>account-deletion, deadline,<br/>vm, mcp"]
    end
```
