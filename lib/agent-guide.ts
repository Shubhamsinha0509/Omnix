/**
 * What to suggest for one agent: prompts to start a chat with, and the setup its job needs.
 *
 * Plain rules over what the user wrote and what the agent can actually do, so they fit any
 * agent anyone creates — not the starter prompts this app shipped with, which were one
 * person's inbox ("Find emails from Outskill") shown to every agent of every user. No
 * model call: it runs on every page load and costs nothing. Plain data in, plain data out,
 * so server pages and client components can both use it.
 */

/** What the rules look at. Built by the page from the agent, its tools, connections and tasks. */
export type AgentFacts = {
  name: string;
  instructions: string;
  /** Tool keys switched on for this agent, e.g. "web.search", "gmail.read". */
  enabledTools: string[];
  /** Tool keys this user could switch on (built-in, plus connected MCP servers'). */
  availableTools: string[];
  /** Providers with an active connection: "gmail", "mcp:notion", "mcp:jira". */
  connectedProviders: string[];
  /** The agent has an enabled scheduled task. */
  hasSchedule: boolean;
  /** E2B is configured, so the VM can be turned on. */
  vmAvailable: boolean;
};

/** One thing the agent's job needs that it doesn't have yet, and the one action that fixes it. */
export type SetupRecommendation = {
  id: "web" | "vm" | "schedule" | "gmail" | "notion" | "jira";
  title: string;
  /** Why, in terms of what the user wrote. */
  why: string;
  action:
    | { kind: "vm"; label: string }
    | { kind: "tools"; label: string; tools: string[] }
    | { kind: "link"; label: string; href: string };
};

/** What the instructions are about. Whole words, so "detail" doesn't match "email". */
function topics(instructions: string) {
  const text = instructions.toLowerCase();
  const has = (pattern: RegExp) => pattern.test(text);
  return {
    recurring: has(/\b(every\s?(day|morning|evening|night|week|weekday|monday|hour)|each\s(day|morning|week)|daily|weekly|hourly|everyday)\b/),
    // Not "inbox" alone: "send it to my inbox" here means Omnix's own Inbox, where results land.
    email: has(/\b(e-?mails?|gmail|mails?|unread|repl(y|ies))\b/),
    jobs: has(/\b(jobs?|roles?|hiring|vacanc(y|ies)|openings?|careers?)\b/),
    news: has(/\b(news|research|articles?|headlines?|trends?|latest)\b/),
    web: has(/\b(search|web|online|websites?|look\s?up|find|browse|news|research|latest|jobs?)\b/),
    code: has(/\b(code|coding|script|scripts|program|python|bugs?|debug)\b/),
    data: has(/\b(csv|spreadsheets?|excel|data|analy[sz]e|analysis|calculat\w*|charts?|graphs?|compare|track|tracker|report)\b/),
    memory: has(/\b(new|only new|haven'?t|since last|remember|keep track|already)\b/),
    notion: has(/\bnotion\b/),
    jira: has(/\b(jira|tickets?|sprints?|backlog)\b/),
  };
}

/**
 * Up to `max` prompts to start a chat with, each one something this agent can actually do
 * with what it has switched on. Ends with "What can you do?" when there is room.
 */
export function suggestionsFor(facts: AgentFacts, max = 3): string[] {
  const t = topics(facts.instructions);
  const on = new Set(facts.enabledTools);
  const web = on.has("web.search") || on.has("web.fetch");
  const vm = [...on].some((key) => key.startsWith("sandbox."));
  const out: string[] = [];
  const add = (text: string, when = true) => {
    if (when && !out.includes(text)) out.push(text);
  };

  // What the user said it's for comes first.
  if (facts.instructions.trim() && t.recurring) add("Do your usual task now");
  add("Find new jobs that match what I'm looking for", t.jobs && web);
  add("Summarize my unread email", (t.email || !facts.instructions.trim()) && on.has("gmail.search"));
  add("Draft replies to emails that need one", t.email && on.has("gmail.create_draft"));
  add("What's the most important news today?", t.news && web);
  add("Help me write and test a small script", t.code && vm);
  add("Work this out exactly with code in your VM", t.data && vm);
  add("What's new in my Notion?", facts.enabledTools.some((key) => key.startsWith("mcp:notion") || key.includes("notion")));
  add("What's assigned to me in Jira?", facts.enabledTools.some((key) => key.includes("jira")));

  // Then what it can do, when the instructions didn't say — but not the web for an agent
  // whose job is something else (an email helper shouldn't be offered a web search).
  add("Look something up on the web for me", web && (!facts.instructions.trim() || t.web) && out.length < max - 1);
  add("What can you do?");
  return out.slice(0, max);
}

/**
 * The setup this agent's job needs and doesn't have yet, most important first. Each one
 * disappears once it's done, so this can be shown until the agent is set up.
 */
export function setupFor(facts: AgentFacts, agentId: string): SetupRecommendation[] {
  const t = topics(facts.instructions);
  if (!facts.instructions.trim()) return [];
  const on = new Set(facts.enabledTools);
  const connected = new Set(facts.connectedProviders);
  const recs: SetupRecommendation[] = [];
  const settings = (tab: string) => `/workspace/agent/${agentId}?configure=${tab}`;

  const webOff = !on.has("web.search") && !on.has("web.fetch");
  if (t.web && webOff) {
    const tools = ["web.search", "web.fetch"].filter((key) => facts.availableTools.includes(key));
    if (tools.length) {
      recs.push({
        id: "web",
        title: "Let it search the web",
        why: `${facts.name} is meant to look things up, but its web search is off.`,
        action: { kind: "tools", label: "Turn on web search", tools },
      });
    }
  }

  if (t.email && !on.has("gmail.search")) {
    recs.push(
      connected.has("gmail")
        ? {
            id: "gmail",
            title: "Let it read your email",
            why: "Its instructions mention email. It can search and read your inbox; it never sends without asking.",
            action: { kind: "tools", label: "Turn on Gmail reading", tools: ["gmail.search", "gmail.read"] },
          }
        : {
            id: "gmail",
            title: "Connect Gmail",
            why: "Its instructions mention email, and no Gmail account is connected yet.",
            action: { kind: "link", label: "Connect Gmail", href: "/workspace/integrations" },
          },
    );
  }

  for (const [id, provider, label, mentioned] of [
    ["notion", "mcp:notion", "Notion", t.notion],
    ["jira", "mcp:jira", "Jira", t.jira],
  ] as const) {
    if (!mentioned) continue;
    const enabled = facts.enabledTools.some((key) => key.toLowerCase().includes(id));
    if (enabled) continue;
    recs.push(
      connected.has(provider)
        ? {
            id,
            title: `Pick its ${label} tools`,
            why: `Its instructions mention ${label}, which is connected, but none of its tools are on for ${facts.name}.`,
            action: { kind: "link", label: `Choose ${label} tools`, href: settings("tools") },
          }
        : {
            id,
            title: `Connect ${label}`,
            why: `Its instructions mention ${label}, and it isn't connected yet.`,
            action: { kind: "link", label: `Connect ${label}`, href: "/workspace/integrations" },
          },
    );
  }

  // A job that repeats and reports "only what's new" needs somewhere to remember what it
  // did; one that crunches data or code needs somewhere to run it. Both are the VM.
  const vmOn = [...on].some((key) => key.startsWith("sandbox."));
  const needsVm = t.data || t.code || (t.recurring && (t.memory || t.jobs || t.news || t.web));
  if (needsVm && !vmOn && facts.vmAvailable) {
    recs.push({
      id: "vm",
      title: "Give it its own computer",
      why:
        t.recurring
          ? "It runs again and again: with a VM it can remember what it already did and report only what's new."
          : "It works with data or code: with a VM it can work things out exactly instead of guessing.",
      action: { kind: "vm", label: "Turn on Isolated VM" },
    });
  }

  if (t.recurring && !facts.hasSchedule) {
    recs.push({
      id: "schedule",
      title: "Run it on a schedule",
      why: "Its instructions say it should run regularly, but it has no schedule yet.",
      action: { kind: "link", label: "Set a schedule", href: settings("schedule") },
    });
  }

  return recs;
}
