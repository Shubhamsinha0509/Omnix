"use client";

import { useState } from "react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentAvatar } from "@/components/custom/workspace/AgentAvatar";
import { cn } from "@/lib/utils";
import type { MockTemplate } from "@/lib/mock-data";

const CATEGORIES = ["All", "Email", "Research", "Engineering", "Productivity", "Sales"] as const;

/** The category tabs and template cards of 16-marketplace. */
export function TemplateGrid({ templates }: { templates: MockTemplate[] }) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const shown = templates.filter((template) => category === "All" || template.category === category);

  return (
    <>
      <Tabs value={category} onValueChange={(value) => setCategory(value as typeof category)} className="max-w-full self-start">
        <TabsList aria-label="Category">
          {CATEGORIES.map((name) => (
            <TabsTrigger key={name} value={name}>
              {name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div id="templates" className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {shown.map((template) => (
          <article key={template.key} className="flex flex-col gap-4 rounded-lg border bg-card p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="size-11 shrink-0">
                <AgentAvatar seed={template.avatarSeed} name="" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <h3 className="text-h3 font-semibold">{template.name}</h3>
                <span className="text-caption font-medium text-muted-foreground">by Omnix</span>
              </div>
            </div>
            <p className="flex-1 text-body-s text-muted-foreground">{template.description}</p>
            <div className="flex flex-wrap gap-1.5">
              {template.tools.map((tool) => (
                <code key={tool} className="rounded-[6px] bg-muted px-1.5 py-0.5 font-mono text-caption text-muted-foreground">
                  {tool}
                </code>
              ))}
            </div>
            <Link
              href={`/workspace/create-agent?template=${template.key}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}
            >
              Use template
            </Link>
          </article>
        ))}
      </div>
    </>
  );
}
