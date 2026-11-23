import { mcpToolSweep } from "./mcp";
import { retentionSweep } from "./retention";
import { runTask, taskScheduler } from "./tasks";

/**
 * Every Inngest function Omnix serves, in one list — what `app/api/inngest/route.ts`
 * registers. The scaffold examples that came with the starter were removed when real
 * background work arrived in Phase 4.
 */
export const functions = [taskScheduler, runTask, retentionSweep, mcpToolSweep];

export { mcpToolSweep, retentionSweep, runTask, taskScheduler };
