import { and, eq } from "drizzle-orm";

import { connections, db } from "@/db";
import { purgeExpiredFlows, refreshMcpTools, serverForProvider } from "@/lib/mcp";
import { inngest } from "./client";

/**
 * Keeping the MCP tool lists current, away from anybody's request.
 *
 * A server's tools are its own to change, and we cache them so that neither an agent run
 * nor a settings page ever waits on a third party to find out what an agent can do
 * (`lib/mcp/tools.ts`). Something has to do the asking, and this is it: hourly, one
 * account at a time, with each refresh its own durable step so one unreachable server
 * doesn't cost the others their turn.
 *
 * It also clears out connect flows nobody finished, which is the common case — people
 * open a consent screen and change their mind.
 */
export const mcpToolSweep = inngest.createFunction(
  { id: "mcp-tool-sweep", name: "Refresh MCP tool lists", retries: 1, concurrency: 1 },
  // Twenty past the hour, so it isn't competing with the minute-by-minute task scheduler
  // at the top of one.
  { cron: "20 * * * *" },
  async ({ step }) => {
    const accounts = await step.run("list-mcp-connections", async () => {
      const rows = await db
        .select({
          id: connections.id,
          userId: connections.userId,
          provider: connections.provider,
        })
        .from(connections)
        .where(and(eq(connections.kind, "mcp"), eq(connections.status, "active")));

      // Only servers still on the allow-list: a row naming one we have removed is left
      // alone rather than refreshed (D49).
      return rows.filter((row) => serverForProvider(row.provider) !== undefined);
    });

    let refreshed = 0;
    let failed = 0;

    for (const account of accounts) {
      // One step per account, and the id is the connection's, so a replay re-uses the
      // results it already has instead of asking every server again.
      const ok = await step.run(`refresh-${account.id}`, async () => {
        const result = await refreshMcpTools(account.userId, {
          id: account.id,
          provider: account.provider,
        });
        return !result.error;
      });

      if (ok) refreshed += 1;
      else failed += 1;
    }

    const flows = await step.run("purge-abandoned-flows", () => purgeExpiredFlows());

    return { accounts: accounts.length, refreshed, failed, flowsPurged: flows };
  },
);
