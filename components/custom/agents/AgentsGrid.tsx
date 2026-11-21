"use client";

import { useState } from "react";
import { Search } from "lucide-react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentCard, NewAgentCard, type AgentCardData } from "@/components/custom/design/AgentCard";

const FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "running", label: "Running" },
  { value: "paused", label: "Paused" },
  { value: "draft", label: "Drafts" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

/** The filter tabs, search box and card grid of 12-agents. */
export function AgentsGrid({ agents }: { agents: AgentCardData[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const shown = agents.filter(
    (agent) =>
      (filter === "all" || agent.status === filter) &&
      (!needle || `${agent.name} ${agent.instructions}`.toLowerCase().includes(needle)),
  );

  return (
    <>
      <div className="flex flex-col items-stretch justify-between gap-3 md:flex-row md:items-center">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <TabsList aria-label="Filter agents">
            {FILTERS.map(({ value, label }) => (
              <TabsTrigger key={value} value={value}>
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <label className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-card px-3 focus-within:border-ring md:max-w-[280px]">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents"
            aria-label="Search agents"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground focus-visible:shadow-none!"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {shown.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
        {filter === "all" && !needle && <NewAgentCard />}
      </div>
      {shown.length === 0 && (filter !== "all" || needle) && (
        <p className="text-center text-body-s text-muted-foreground">No agents match.</p>
      )}
    </>
  );
}
