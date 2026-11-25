import { closeStaleRuns } from "@/lib/agent/runs";
import { enforceVmCaps } from "@/lib/sandbox";
import { inngest } from "./client";

/**
 * Every 10 minutes, closes runs whose worker has gone, so none shows as running or
 * waiting for ever (`closeStaleRuns`). Pages also run it for their own user when they
 * load, which covers development without the Inngest dev server.
 */
export const staleRunSweep = inngest.createFunction(
  { id: "stale-run-sweep", name: "Close runs that stopped responding", retries: 1, concurrency: 1 },
  { cron: "*/10 * * * *" },
  async ({ step }) => {
    const closed = await step.run("close-stale-runs", () => closeStaleRuns());
    // VMs past their owner's monthly allowance stop, keeping their files (lib/vm-usage.ts).
    const vmsStopped = await step.run("enforce-vm-caps", () => enforceVmCaps());
    return { closed, vmsStopped };
  },
);
