import { and, eq } from "drizzle-orm";
import { Sandbox, SandboxNotFoundError } from "@e2b/desktop";

import { db, sandboxes, type SandboxRow } from "@/db";
import { recordVmStretch, vmBudget, vmCapMessage } from "@/lib/vm-usage";
import { setupNotice } from "@/lib/setup";

/**
 * Each agent's own VM (D15, docs/06-virtual-machines.md): an E2B desktop sandbox, so it can
 * run code, use a real browser, and show its screen live in the run panel.
 *
 * Server only. Callers check that the agent belongs to the user first; every function here
 * also scopes its writes to `userId`, so a mistake there can't reach someone else's VM.
 *
 * The rules that matter:
 * - **One VM per agent.** Each change first *claims* the row by moving it to an in-between
 *   status (`starting`, `pausing`, `stopping`) with a conditional update. Whoever wins the
 *   claim does the work; a second click finds the claim and gets the current state back.
 * - **Idle VMs pause themselves.** E2B pauses a VM `IDLE_MS` after it was started or
 *   resumed (`onTimeout: "pause"`), keeping its disk and memory and costing no compute.
 *   We don't hear about that, so `getSandbox` asks E2B whenever our record says the time
 *   has passed.
 * - **Paused VMs are kept forever by E2B** until killed, so deleting an agent must kill
 *   its VM (`destroySandbox`), or it would sit there for good.
 * - **No secrets in the VM.** Nothing from our environment is passed in; the VM gets only
 *   what a single tool call needs, later (docs/07-security.md).
 */

/** How long a VM runs after a start or resume before E2B pauses it. */
export const IDLE_MS = 10 * 60 * 1000;

/** The desktop's screen size, which is also the live stream's. */
const RESOLUTION: [number, number] = [1280, 800];

/** A claim older than this was left by a request that died; it may be taken over. */
const STALE_CLAIM_MS = 2 * 60 * 1000;

export type SandboxStatus = SandboxRow["status"];

/** What the browser may know about an agent's VM. E2B's own id stays on the server. */
export type SandboxView = {
  status: SandboxStatus;
  error: string | null;
  runningSince: string | null;
  expiresAt: string | null;
  usedSeconds: number;
  /** This month's VM time against the plan (lib/vm-usage.ts); set by `getSandbox`. */
  budget?: { usedSeconds: number; allowanceSeconds: number };
};

export type SandboxResult = { error: string } | { vm: SandboxView };

const OFF: SandboxView = { status: "stopped", error: null, runningSince: null, expiresAt: null, usedSeconds: 0 };

/** True when E2B is configured. Without a key there are no VMs, and the UI says so. */
export function hasSandboxKey() {
  return Boolean(process.env.E2B_API_KEY);
}

/** Shown when E2B_API_KEY is missing: the fix locally, a plain notice in production (D60). */
export const vmSetupNotice = () => setupNotice("VMs", "add E2B_API_KEY to .env and restart the dev server.");

function toView(row: SandboxRow | undefined): SandboxView {
  if (!row) return OFF;
  return {
    status: row.status,
    error: row.error,
    runningSince: row.runningSince?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    usedSeconds: row.usedSeconds,
  };
}

/** Seconds of the current running stretch, counted up to `until` (or the auto-pause). */
function stretchSeconds(row: SandboxRow, until = new Date()) {
  if (!row.runningSince) return 0;
  const end = row.expiresAt && row.expiresAt < until ? row.expiresAt : until;
  return Math.max(0, Math.round((end.getTime() - row.runningSince.getTime()) / 1000));
}

/**
 * Ends the current running stretch: records it for the monthly VM allowance and returns
 * its seconds, for the all-time total. Called once wherever a running VM stops running.
 */
async function endStretch(row: SandboxRow, until = new Date()) {
  const seconds = stretchSeconds(row, until);
  if (row.runningSince) {
    const endedAt = row.expiresAt && row.expiresAt < until ? row.expiresAt : until;
    try {
      await recordVmStretch({ userId: row.userId, agentId: row.agentId, startedAt: row.runningSince, endedAt, seconds });
    } catch (error) {
      // Usage must not stop the VM from stopping; the all-time total still counts it.
      console.error("Couldn't record VM usage:", error);
    }
  }
  return seconds;
}

/**
 * How long the VM may run before E2B stops it: the idle period, or what is left of the
 * month's allowance if that is shorter, so a VM can't run past the plan's cap unseen.
 */
async function runForMs(userId: number) {
  const budget = await vmBudget(userId);
  return { budget, ms: Math.min(IDLE_MS, Math.max(5_000, budget.leftSeconds * 1000)) };
}

async function readRow(userId: number, agentId: string) {
  const [row] = await db
    .select()
    .from(sandboxes)
    .where(and(eq(sandboxes.agentId, agentId), eq(sandboxes.userId, userId)))
    .limit(1);
  return row;
}

/** Writes the outcome of a change. Scoped to the user, like every write here. */
async function save(userId: number, agentId: string, values: Partial<SandboxRow>) {
  const [row] = await db
    .update(sandboxes)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(sandboxes.agentId, agentId), eq(sandboxes.userId, userId)))
    .returning();
  return row;
}

/**
 * Moves the row from one of `from` to `to`, and says whether this request won. A claim
 * left behind by a request that died (older than `STALE_CLAIM_MS`) counts as free.
 */
async function claim(
  userId: number,
  agentId: string,
  row: SandboxRow,
  from: SandboxStatus[],
  to: SandboxStatus,
): Promise<boolean> {
  const stale = ["starting", "pausing", "stopping"].includes(row.status) &&
    Date.now() - row.updatedAt.getTime() > STALE_CLAIM_MS;
  if (!from.includes(row.status) && !stale) return false;

  const [won] = await db
    .update(sandboxes)
    .set({ status: to, error: null, updatedAt: new Date() })
    .where(
      and(
        eq(sandboxes.agentId, agentId),
        eq(sandboxes.userId, userId),
        // Only if it is still in the state we read: of two requests, one wins. (Not
        // `updatedAt`: Postgres keeps microseconds a JS Date can't, so it never matches.)
        eq(sandboxes.status, row.status),
      ),
    )
    .returning({ agentId: sandboxes.agentId });
  return Boolean(won);
}

/** The row for this agent, created as "stopped" the first time anyone asks. */
async function ensureRow(userId: number, agentId: string) {
  await db.insert(sandboxes).values({ agentId, userId }).onConflictDoNothing();
  return readRow(userId, agentId);
}

/**
 * The agent's VM as it is now. If our record says running but the idle time has passed,
 * E2B has most likely paused it; ask, and bring the record up to date.
 */
export async function getSandbox(userId: number, agentId: string): Promise<SandboxView> {
  const view = await currentSandbox(userId, agentId);
  const budget = await vmBudget(userId);

  // Over the month's allowance: a VM still running stops now, keeping its files.
  if (view.status === "running" && budget.leftSeconds <= 0) {
    const paused = await pauseSandbox(userId, agentId);
    const after = "vm" in paused ? paused.vm : view;
    return { ...after, error: vmCapMessage(budget), budget: { usedSeconds: budget.usedSeconds, allowanceSeconds: budget.allowanceSeconds } };
  }
  return { ...view, budget: { usedSeconds: budget.usedSeconds, allowanceSeconds: budget.allowanceSeconds } };
}

/** The VM as our record and E2B say it is, without the allowance check. */
async function currentSandbox(userId: number, agentId: string): Promise<SandboxView> {
  const row = await readRow(userId, agentId);
  if (!row) return OFF;
  if (row.status !== "running" || !row.providerId || !row.expiresAt || row.expiresAt > new Date()) {
    return toView(row);
  }
  if (!hasSandboxKey()) return toView(row);

  try {
    const info = await Sandbox.getInfo(row.providerId);
    if (info.state === "running") {
      // Someone kept it alive (a resume elsewhere moved the deadline): just follow E2B.
      return toView(await save(userId, agentId, { expiresAt: info.endAt }));
    }
    return toView(
      await save(userId, agentId, {
        status: "paused",
        usedSeconds: row.usedSeconds + (await endStretch(row)),
        runningSince: null,
        expiresAt: null,
      }),
    );
  } catch (error) {
    if (error instanceof SandboxNotFoundError) {
      return toView(
        await save(userId, agentId, {
          status: "stopped",
          providerId: null,
          usedSeconds: row.usedSeconds + (await endStretch(row)),
          runningSince: null,
          expiresAt: null,
        }),
      );
    }
    // E2B unreachable: show what we last knew rather than failing the page.
    console.error("Couldn't check the VM's state:", error);
    return toView(row);
  }
}

/**
 * Starts the agent's VM, or resumes it if it is paused. Returns at once if it is already
 * running or another request is starting it.
 */
export async function startSandbox(userId: number, agentId: string): Promise<SandboxResult> {
  if (!hasSandboxKey()) return { error: vmSetupNotice() };

  // The plan's monthly VM time (lib/vm-usage.ts): nothing starts once it's used up.
  const { budget, ms: runFor } = await runForMs(userId);
  if (budget.leftSeconds <= 0) return { error: vmCapMessage(budget) };

  const row = await ensureRow(userId, agentId);
  if (!row) return { error: "Couldn't find this agent's VM record. Please try again." };
  if (!(await claim(userId, agentId, row, ["stopped", "paused", "error"], "starting"))) {
    return { vm: toView(await readRow(userId, agentId)) };
  }

  const startedAt = new Date();
  try {
    let vm: Sandbox | null = null;

    // A paused VM comes back with its files and memory; connecting resumes it.
    if (row.providerId) {
      try {
        vm = await Sandbox.connect(row.providerId, { timeoutMs: runFor });
      } catch (error) {
        // Gone on E2B's side (killed elsewhere): start a fresh one below.
        if (!(error instanceof SandboxNotFoundError)) throw error;
      }
    }

    vm ??= await Sandbox.create({
      timeoutMs: runFor,
      lifecycle: { onTimeout: "pause", autoResume: false },
      // Only our own ids: nothing personal, nothing secret.
      metadata: { agentId },
      resolution: RESOLUTION,
      // The live screen is an iframe, and a browser can't add E2B's traffic-token header
      // to one, so the VM's addresses must accept traffic without it (D51). The screen
      // itself still needs a fresh password on every open.
      network: { allowPublicTraffic: true },
    });

    const saved = await save(userId, agentId, {
      status: "running",
      providerId: vm.sandboxId,
      error: null,
      runningSince: startedAt,
      expiresAt: new Date(startedAt.getTime() + runFor),
    });
    return { vm: toView(saved) };
  } catch (error) {
    console.error("Failed to start the VM:", error);
    const saved = await save(userId, agentId, {
      status: "error",
      error: "The VM didn't start. Please try again in a moment.",
      runningSince: null,
      expiresAt: null,
    });
    return { error: saved?.error ?? "The VM didn't start." };
  }
}

/** Pauses a running VM: its files and memory are kept, and it costs nothing while paused. */
export async function pauseSandbox(userId: number, agentId: string): Promise<SandboxResult> {
  if (!hasSandboxKey()) return { error: vmSetupNotice() };

  const row = await readRow(userId, agentId);
  if (!row?.providerId) return { vm: toView(row) };
  if (!(await claim(userId, agentId, row, ["running"], "pausing"))) {
    return { vm: toView(await readRow(userId, agentId)) };
  }

  const pausedAt = new Date();
  try {
    await Sandbox.pause(row.providerId);
    const saved = await save(userId, agentId, {
      status: "paused",
      usedSeconds: row.usedSeconds + (await endStretch(row, pausedAt)),
      runningSince: null,
      expiresAt: null,
    });
    return { vm: toView(saved) };
  } catch (error) {
    if (error instanceof SandboxNotFoundError) {
      const saved = await save(userId, agentId, {
        status: "stopped",
        providerId: null,
        usedSeconds: row.usedSeconds + (await endStretch(row, pausedAt)),
        runningSince: null,
        expiresAt: null,
      });
      return { vm: toView(saved) };
    }
    console.error("Failed to pause the VM:", error);
    // It is still running: put the record back so the user can try again.
    // Shown to the user, who knows this action as "Stop".
    await save(userId, agentId, { status: "running", error: "Couldn't stop the VM. Please try again." });
    return { error: "Couldn't stop the VM. Please try again." };
  }
}

/** Stops the VM for good: E2B deletes it with everything on it. The usage total stays. */
export async function stopSandbox(userId: number, agentId: string): Promise<SandboxResult> {
  if (!hasSandboxKey()) return { error: vmSetupNotice() };

  const row = await readRow(userId, agentId);
  if (!row?.providerId) return { vm: toView(row) };
  if (!(await claim(userId, agentId, row, ["running", "paused", "error"], "stopping"))) {
    return { vm: toView(await readRow(userId, agentId)) };
  }

  const stoppedAt = new Date();
  try {
    // False when E2B no longer has it, which is the same outcome.
    await Sandbox.kill(row.providerId);
    const saved = await save(userId, agentId, {
      status: "stopped",
      providerId: null,
      error: null,
      usedSeconds: row.usedSeconds + (row.status === "running" ? await endStretch(row, stoppedAt) : 0),
      runningSince: null,
      expiresAt: null,
    });
    return { vm: toView(saved) };
  } catch (error) {
    console.error("Failed to stop the VM:", error);
    // Shown to the user, who knows this action as "Delete VM".
    await save(userId, agentId, { status: row.status, error: "Couldn't delete the VM. Please try again." });
    return { error: "Couldn't delete the VM. Please try again." };
  }
}

/**
 * A running VM for one tool call, started or resumed if it has to be (docs/06: "first
 * sandbox tool call → create VM, or resume if paused").
 *
 * If someone else is already starting it (the user's click, another call), this waits for
 * them rather than racing. Every call counts as use, so the auto-pause moves back by
 * `IDLE_MS`. The returned object is for this call only; nothing holds on to it.
 */
export async function sandboxForTool(
  userId: number,
  agentId: string,
  signal?: AbortSignal,
): Promise<{ error: string } | { vm: Sandbox }> {
  if (!hasSandboxKey()) return { error: vmSetupNotice() };

  const deadline = Date.now() + 60_000;
  let view = await getSandbox(userId, agentId);
  while (view.status !== "running") {
    if (signal?.aborted) return { error: "Stopped." };
    if (Date.now() > deadline) return { error: "The VM took too long to start. Try again in a moment." };

    if (["stopped", "paused", "error"].includes(view.status)) {
      const started = await startSandbox(userId, agentId);
      if ("error" in started) return started;
      view = started.vm;
    } else {
      // Starting, pausing or stopping elsewhere: wait for it to settle, then carry on.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      view = await getSandbox(userId, agentId);
    }
  }

  const row = await readRow(userId, agentId);
  if (!row?.providerId) return { error: "The VM isn't available. Please try again." };
  // Within the month's allowance (getSandbox above has already stopped a VM past it).
  const { budget, ms: runFor } = await runForMs(userId);
  if (budget.leftSeconds <= 0) return { error: vmCapMessage(budget) };
  try {
    const vm = await Sandbox.connect(row.providerId, { timeoutMs: runFor });
    await save(userId, agentId, { expiresAt: new Date(Date.now() + runFor) });
    return { vm };
  } catch (error) {
    console.error("Couldn't connect to the VM for a tool call:", error);
    return { error: "Couldn't reach the VM. Please try again." };
  }
}

/** A running VM's size and how much of it is in use, as the VM card shows it. */
export type SandboxStats = {
  cpuCount: number;
  /** Percent of all CPUs, or null before E2B has a first sample. */
  cpuUsedPct: number | null;
  memoryUsedMB: number | null;
  memoryTotalMB: number;
  diskUsedMB: number | null;
  diskTotalMB: number | null;
};

const MB = 1024 * 1024;

/**
 * The running VM's CPU, memory and disk, from E2B's metrics (the newest sample of the last
 * minute). Just after a start there may be no sample yet; then the size comes from the
 * VM's info and the "used" figures are null rather than a made-up zero.
 */
export async function getSandboxStats(
  userId: number,
  agentId: string,
): Promise<{ error: string } | { stats: SandboxStats }> {
  if (!hasSandboxKey()) return { error: vmSetupNotice() };
  const row = await readRow(userId, agentId);
  if (row?.status !== "running" || !row.providerId) return { error: "The VM isn't running." };

  try {
    const samples = await Sandbox.getMetrics(row.providerId, { start: new Date(Date.now() - 60_000) });
    const last = samples.at(-1);
    if (last) {
      return {
        stats: {
          cpuCount: last.cpuCount,
          cpuUsedPct: Math.round(last.cpuUsedPct),
          memoryUsedMB: Math.round(last.memUsed / MB),
          memoryTotalMB: Math.round(last.memTotal / MB),
          diskUsedMB: Math.round(last.diskUsed / MB),
          diskTotalMB: Math.round(last.diskTotal / MB),
        },
      };
    }
    const info = await Sandbox.getInfo(row.providerId);
    return {
      stats: {
        cpuCount: info.cpuCount,
        cpuUsedPct: null,
        memoryUsedMB: null,
        memoryTotalMB: info.memoryMB,
        diskUsedMB: null,
        diskTotalMB: null,
      },
    };
  } catch (error) {
    console.error("Couldn't read the VM's metrics:", error);
    return { error: "Couldn't read the VM's usage." };
  }
}

/** Links to the VM's live screen: one to watch, one to use the mouse and keyboard. */
export type SandboxScreen = { viewUrl: string; controlUrl: string };

/**
 * Opens the running VM's live screen (an E2B desktop VNC stream) and returns its links.
 *
 * The stream is password-protected, and the SDK holds that password only in the object
 * that started the stream, so each call restarts it with a fresh one: links from an earlier
 * call stop working, which is also what keeps an old link from being reused. The links are
 * for the owner's browser only and are never stored. Watching counts as using the VM, so
 * this also pushes its auto-pause back by `IDLE_MS`.
 */
export async function openSandboxScreen(
  userId: number,
  agentId: string,
): Promise<{ error: string } | { screen: SandboxScreen; vm: SandboxView }> {
  if (!hasSandboxKey()) return { error: vmSetupNotice() };

  const row = await readRow(userId, agentId);
  if (row?.status !== "running" || !row.providerId) return { error: "Start the VM to see its screen." };
  const { budget, ms: runFor } = await runForMs(userId);
  if (budget.leftSeconds <= 0) return { error: vmCapMessage(budget) };

  try {
    const vm = await Sandbox.connect(row.providerId, { timeoutMs: runFor });
    try {
      await vm.stream.stop();
    } catch {
      // Not running yet: nothing to stop.
    }
    await vm.stream.start({ requireAuth: true });
    const authKey = vm.stream.getAuthKey();
    const base = { autoConnect: true, resize: "scale" as const, authKey };

    const saved = await save(userId, agentId, { expiresAt: new Date(Date.now() + runFor) });
    return {
      screen: {
        viewUrl: vm.stream.getUrl({ ...base, viewOnly: true }),
        controlUrl: vm.stream.getUrl({ ...base, viewOnly: false }),
      },
      vm: toView(saved),
    };
  } catch (error) {
    if (error instanceof SandboxNotFoundError) {
      await save(userId, agentId, {
        status: "stopped",
        providerId: null,
        usedSeconds: row.usedSeconds + (await endStretch(row)),
        runningSince: null,
        expiresAt: null,
      });
      return { error: "The VM is no longer running. Start it again to see its screen." };
    }
    console.error("Failed to open the VM's screen:", error);
    return { error: "Couldn't open the VM's screen. Please try again." };
  }
}

/**
 * Stops (keeping files) every running VM whose owner is past the month's allowance. E2B's
 * own timer already stops a VM at the cap (`runForMs`); this catches anything that slipped
 * through, such as a VM started before the allowance was lowered. For the background sweep.
 */
export async function enforceVmCaps() {
  const running = await db
    .select({ userId: sandboxes.userId, agentId: sandboxes.agentId })
    .from(sandboxes)
    .where(eq(sandboxes.status, "running"));
  let stopped = 0;
  const over = new Map<number, boolean>();
  for (const { userId, agentId } of running) {
    if (!over.has(userId)) over.set(userId, (await vmBudget(userId)).leftSeconds <= 0);
    if (over.get(userId) && "vm" in (await pauseSandbox(userId, agentId))) stopped++;
  }
  return stopped;
}

/**
 * Kills an agent's VM before the agent is deleted. Paused VMs are never removed by E2B on
 * their own, so skipping this would leave the user's files there for good. The row goes
 * with the agent (cascade). Failures are logged, not thrown: deleting the agent must not
 * depend on E2B being up, and the VM is tagged with the agent id to find it later.
 */
export async function destroySandbox(userId: number, agentId: string) {
  const row = await readRow(userId, agentId);
  if (!row?.providerId || !hasSandboxKey()) return;
  try {
    await Sandbox.kill(row.providerId);
  } catch (error) {
    console.error(`Couldn't kill VM ${row.providerId} of deleted agent ${agentId}:`, error);
  }
}
