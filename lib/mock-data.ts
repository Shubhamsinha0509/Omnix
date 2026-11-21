/**
 * MOCK DATA for parts of the redesign that have no backend yet.
 *
 * Every export here is a stand-in, typed the way the real data will be, so a screen can
 * switch to a query without changing its markup. Search for "TODO(backend)" to find what
 * each one is waiting on. Nothing in this file is read by the agent runner or the API.
 */

/**
 * The user's plan and its allowances. Usage itself is real (lib/usage.ts, from the run
 * log); what it is measured against isn't.
 * TODO(backend): plans, limits and billing (docs/08-roadmap.md, Phase 7; pricing is an
 * open question). The Pro price is the design's placeholder until it is decided.
 */
export type Plan = {
  name: "Free" | "Pro";
  tokensPerMonth: number;
  webSearchesPerMonth: number;
  scheduledAgents: number | "unlimited";
};

export const MOCK_PLAN: Plan = {
  name: "Free",
  tokensPerMonth: 100_000,
  webSearchesPerMonth: 100,
  scheduledAgents: 3,
};

export const MOCK_PLANS = [
  {
    name: "Free",
    price: null,
    features: ["100K tokens / month", "3 scheduled agents", "Community support"],
  },
  {
    name: "Pro",
    price: "[YOUR PRICE] / month",
    features: ["Higher monthly token limit", "Unlimited scheduled agents", "Advanced models", "Priority support"],
  },
] as const;

/** TODO(backend): invoices come with billing. */
export const MOCK_INVOICES: { id: string; date: string; amount: string }[] = [];

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

/**
 * Marketplace templates. "Use template" opens Create agent filled in from one of these.
 * TODO(backend): a templates table (and community templates). Tools named here that
 * don't exist yet (slack.post, github.read, …) are shown for the design but not granted.
 */
export type MockTemplate = {
  key: string;
  name: string;
  description: string;
  category: "Email" | "Research" | "Engineering" | "Productivity" | "Sales";
  tools: string[];
  avatarSeed: string;
  instructions: string;
};

export const MOCK_TEMPLATES: MockTemplate[] = [
  {
    key: "inbox-digest",
    name: "Inbox digest",
    description: "Summarizes unread email each morning and groups duplicate threads.",
    category: "Email",
    tools: ["gmail.read", "slack.post"],
    avatarSeed: "green-inbox",
    instructions:
      "Every weekday morning, read my unread Gmail from the last 24 hours. Group duplicate threads, flag anything that needs a reply, and post a short digest to my Inbox.",
  },
  {
    key: "research-brief",
    name: "Research brief",
    description: "Finds the day’s top stories on a topic and writes two-line summaries.",
    category: "Research",
    tools: ["web.search", "web.fetch"],
    avatarSeed: "purple-research",
    instructions:
      "Find the 5 most important stories on the topic I give you, summarize each in two lines, and link the source.",
  },
  {
    key: "code-reviewer",
    name: "Code reviewer",
    description: "Reads a pull request and leaves review notes you can edit.",
    category: "Engineering",
    tools: ["github.read"],
    avatarSeed: "peach-review",
    instructions:
      "Review the pull request I share. Point out bugs, risky changes and missing tests first, then style. Keep each note short and specific.",
  },
  {
    key: "standup-writer",
    name: "Standup writer",
    description: "Turns yesterday’s Jira updates into a standup note.",
    category: "Productivity",
    tools: ["jira.read", "slack.post"],
    avatarSeed: "teal-standup",
    instructions:
      "Each weekday at 9:30, turn yesterday's Jira updates into a three-part standup note: done, doing, blocked.",
  },
  {
    key: "meeting-prep",
    name: "Meeting prep",
    description: "Pulls the agenda, attendees and related docs before each meeting.",
    category: "Productivity",
    tools: ["calendar.read", "drive.read"],
    avatarSeed: "green-meeting",
    instructions:
      "Before each meeting, list the agenda, who is attending and any related documents, in five lines or fewer.",
  },
  {
    key: "lead-follow-up",
    name: "Lead follow-up",
    description: "Drafts a follow-up email after each new form response.",
    category: "Sales",
    tools: ["gmail.create_draft"],
    avatarSeed: "purple-lead",
    instructions:
      "When I paste a new lead's form response, draft a friendly follow-up email that answers what they asked and suggests a next step. Save it as a draft; never send.",
  },
];

/** The template the Marketplace features in its hero. */
export const MOCK_FEATURED_TEMPLATE = {
  key: "inbox-digest",
  title: "Inbox digest",
  pitch:
    "Every weekday at 9:00, read unread Gmail, group duplicate threads, and post a short digest to your Inbox or Slack.",
};

/**
 * Settings sections with nothing behind them yet. Shown as designed, disabled.
 * TODO(backend): API keys for running agents from code; notification preferences
 * (approval requests always reach the Inbox today, and failure emails need RESEND_API_KEY).
 */
export type ApiKey = { id: string; name: string; preview: string; createdAt: string; lastUsed: string | null };
export const MOCK_API_KEYS: ApiKey[] = [];

export const MOCK_NOTIFICATION_PREFS = [
  { key: "approvals", title: "Approval requests", note: "When an agent wants to send, post or edit.", on: true },
  { key: "failures", title: "Failed runs", note: "Email me when a scheduled run fails.", on: true },
  { key: "weekly", title: "Weekly summary", note: "What your agents did this week.", on: false },
];
