// Type only: works on the server and in the browser alike.
import type { ToolSetting } from "@/lib/tools";

/**
 * An agent's Isolated VM setting, as its tool grants express it (D53). Plain data and a
 * plain function, so a server page and a client component can both use it.
 */
export type VmState = {
  /** False when E2B isn't configured: the VM tools aren't offered at all. */
  available: boolean;
  /** On when any VM tool is on (the switch turns them all on or off together). */
  enabled: boolean;
  /** Running code doesn't ask first. */
  trusted: boolean;
};

export function vmStateOf(tools: ToolSetting[]): VmState {
  const vm = tools.filter((tool) => tool.key.startsWith("sandbox."));
  return {
    available: vm.length > 0,
    enabled: vm.some((tool) => tool.enabled),
    trusted: vm.find((tool) => tool.key === "sandbox.run_code")?.approval === "never",
  };
}
