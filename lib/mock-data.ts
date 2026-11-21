/**
 * MOCK DATA for parts of the redesign that have no backend yet.
 *
 * Every export here is a stand-in, typed the way the real data will be, so a screen can
 * switch to a query without changing its markup. Search for "TODO(backend)" to find what
 * each one is waiting on. Nothing in this file is read by the agent runner or the API.
 */

/** TODO(backend): token metering per user per month (docs/08-roadmap.md, Phase 7). */
export type UsageSummary = {
  plan: "Free" | "Pro";
  /** Share of this month's token allowance used, 0–100. */
  tokensUsedPercent: number;
};

export const MOCK_USAGE: UsageSummary = {
  plan: "Free",
  tokensUsedPercent: 12,
};

/**
 * Per-agent settings shown in the drawer's Settings tab that nothing reads yet.
 * TODO(backend): Isolated VM is Phase 6 (E2B, docs/06-vms.md); "remember past chats"
 * needs cross-conversation context in the runner. Shown disabled until then.
 */
export const MOCK_AGENT_SETTINGS = {
  isolatedVm: true,
  rememberPastChats: false,
};

/**
 * Sample inbox for design checks only: `/workspace/inbox?preview=sample` in development.
 * The real inbox reads `notifications` (lib/notifications.ts); nothing here is stored.
 */
export const MOCK_INBOX_ITEMS = (agent: { id: string; name: string; avatarSeed: string }) => {
  const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const base = {
    agentId: agent.id,
    agentName: agent.name,
    agentAvatarSeed: agent.avatarSeed,
    taskName: null,
    runId: null,
  };
  return [
    {
      ...base,
      id: "sample-approval",
      kind: "approval_request" as const,
      title: "Wants to send an email",
      body: "",
      unread: true,
      createdAt: at(2),
      approval: {
        id: "sample-approval",
        tool: "gmail.send",
        label: "Sending email",
        summary: `${agent.name} wants to send an email`,
        details: [
          { label: "To", value: "Outskill (Zoom)" },
          { label: "Message", value: "Thanks for the reminder. See you at 6:55 PM." },
        ],
        expiresAt: at(-60 * 24),
        resumable: true,
      },
      approvalState: "pending" as const,
    },
    {
      ...base,
      id: "sample-digest",
      kind: "task_result" as const,
      title: "Morning inbox digest",
      body: "5 new emails since yesterday. All unread. Two were the same Outskill thread, so they're listed once.\n\n| From | Subject | Time |\n| --- | --- | --- |\n| Outskill (Zoom) | Claude Code 101 webinar: reminder | 12:26 |\n| Nate Herk | Newsletter teaser from AI Automation Society | 15:04 |\n| Zomato | Promo: order food instead of cooking | 11:43 |",
      unread: true,
      createdAt: at(90),
      approval: null,
      approvalState: null,
    },
    {
      ...base,
      id: "sample-failed",
      kind: "task_failed" as const,
      title: "Run failed",
      body: "GitHub isn't connected yet",
      unread: false,
      createdAt: at(60 * 26),
      approval: null,
      approvalState: null,
    },
  ];
};

/**
 * Apps shown on Integrations that can't be connected yet.
 * TODO(backend): Phase 5 — Slack, Notion and Jira over MCP (docs/05-integrations.md);
 * the rest after. Gmail is real and is not in this list.
 */
export type MockIntegration = {
  key: string;
  name: string;
  description: string;
  mark: string;
  color: string;
};

export const MOCK_INTEGRATIONS: MockIntegration[] = [
  { key: "google-drive", name: "Google Drive", description: "Find and read files you choose to share.", mark: "D", color: "#0F9D58" },
  { key: "slack", name: "Slack", description: "Read channels and post messages as you.", mark: "S", color: "#611F69" },
  { key: "notion", name: "Notion", description: "Search pages and add notes to databases.", mark: "N", color: "#37352F" },
  { key: "jira", name: "Jira", description: "Read issues and summarize sprint progress.", mark: "J", color: "#0052CC" },
  { key: "google-calendar", name: "Google Calendar", description: "See your events and suggest free time.", mark: "C", color: "#4285F4" },
  { key: "github", name: "GitHub", description: "Read repositories, issues and pull requests.", mark: "GH", color: "#24292F" },
  { key: "discord", name: "Discord", description: "Read and reply in servers you choose.", mark: "Di", color: "#5865F2" },
];
