import path from "node:path";
import { CommandExitError, type Sandbox } from "@e2b/desktop";

import { sandboxForTool } from "@/lib/sandbox";
import type { ToolContext, ToolDefinition, ToolResult } from "./types";

/**
 * Tools that run inside the agent's own VM (docs/06-virtual-machines.md, Phase 6).
 *
 * The agent loop stays on our server; only these tools reach into the VM (D12). The first
 * call starts the VM, or resumes it if paused, and every call keeps it awake for another
 * idle period. The user can watch all of it on the live screen in the run panel.
 *
 * Safety:
 * - Off by default for every agent (`runsIn: "sandbox"` in `defaultEnabled`), and only
 *   offered at all when E2B is configured.
 * - Running code and writing files are `write`: the user is asked unless they chose to
 *   trust that tool on that agent (D29). Code in the VM can reach the internet, which is a
 *   way out for anything the agent has read, and the approval card shows the code itself.
 * - Nothing secret is ever put in the VM, so there is nothing there to steal (D12).
 * - Paths stay inside the VM user's home, `/home/user`.
 * - Everything that comes back is output from code or pages we don't control, so it is
 *   marked untrusted like a web page (docs/07-security.md).
 */

const HOME = "/home/user";

/** How much of stdout / stderr / a file goes back to the model, each. */
const MAX_TEXT = 8_000;

/** How long code may run, inside the tool's own limit (which also covers starting the VM). */
const RUN_TIMEOUT_MS = 90_000;

/** Starting a VM takes ~10 s; these tools get room for that on top of their own work. */
const VM_TOOL_TIMEOUT_MS = 60_000;

/**
 * What the E2B desktop image actually has. Node isn't installed there (checked live).
 * Python runs unbuffered (`-u`) so its output reaches the on-screen terminal line by line.
 */
const LANGUAGES = {
  python: { file: "py", command: "python3 -u", shown: "python3" },
  bash: { file: "sh", command: "bash", shown: "bash" },
} as const;

/**
 * Opens a terminal window on the VM's desktop that shows the program and then follows its
 * output live, ending with the exit code: what the user sees on the live screen while the
 * agent's code runs. It only *watches* a log; the program itself runs once, in `execute`,
 * whose captured output is what goes back to the model.
 *
 * One window at a time: the previous one is closed first. The window closes itself two
 * minutes after the program ends. Anything going wrong here is ignored — seeing the code
 * run is a nicety, and must never stop it running.
 */
async function showInTerminal(vm: Sandbox, run: { file: string; log: string; exit: string; language: Language }) {
  const viewer = run.file.replace(/\.\w+$/, ".show.sh");
  const name = path.posix.basename(run.file);
  const script = [
    "printf '\\033[1;36mThe agent is running %s\\033[0m\\n\\n' " + `'${run.language}'`,
    `cat -n '${run.file}'`,
    // The model's code often has no final newline; keep the command on a line of its own.
    "echo",
    `printf '\\n\\033[1;33m$ ${LANGUAGES[run.language].shown} ${name}\\033[0m\\n'`,
    `touch '${run.log}'`,
    `tail -n +1 -f '${run.log}' & TAIL=$!`,
    // Wait for the exit code (at most ~2 minutes: a run killed by its timeout writes none).
    `for i in $(seq 1 600); do [ -f '${run.exit}' ] && break; sleep 0.2; done`,
    "sleep 0.3; kill $TAIL 2>/dev/null",
    `CODE=$(cat '${run.exit}' 2>/dev/null || echo '?')`,
    `if [ "$CODE" = 0 ]; then C=32; else C=31; fi`,
    `printf '\\n\\033[1;%sm[exit %s]\\033[0m\\n' "$C" "$CODE"`,
    "sleep 120",
  ].join("\n");

  try {
    await vm.files.write(viewer, script);
    // Close the last run's window (its viewer script ending closes the terminal).
    await vm.commands.run("pkill -f '/home/user/.omnix/.*\\.show\\.sh' || true", { timeoutMs: 5_000 });
    await vm.commands.run(
      `xfce4-terminal --title='Agent · ${run.language}' --geometry=110x32+40+40 -x bash '${viewer}'`,
      { background: true, envs: { DISPLAY: ":0" } },
    );
  } catch (error) {
    console.error("Couldn't show the run in a terminal on the VM's screen:", error);
  }
}
type Language = keyof typeof LANGUAGES;

/** Cuts long text and says so, keeping the start (where errors and headers usually are). */
function clip(text: string | undefined, max = MAX_TEXT) {
  const value = text ?? "";
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[cut: ${value.length - max} more characters]`;
}

/**
 * A path inside the VM user's home, or an error. Relative paths are taken from the home
 * directory; anything that would leave it (`..`, `/etc/…`) is refused.
 */
function homePath(raw: unknown): { path: string } | { error: string } {
  const given = typeof raw === "string" ? raw.trim() : "";
  if (!given) return { error: "Give a path, e.g. report.csv or /home/user/data/report.csv." };
  const resolved = path.posix.normalize(path.posix.isAbsolute(given) ? given : path.posix.join(HOME, given));
  if (resolved !== HOME && !resolved.startsWith(`${HOME}/`)) {
    return { error: `Only files under ${HOME} can be used. "${given}" is outside it.` };
  }
  return { path: resolved };
}

/** The agent's VM for this call, or the reason there isn't one. */
async function vmFor(ctx: ToolContext): Promise<{ error: string } | { vm: Sandbox }> {
  return sandboxForTool(ctx.user.id, ctx.agent.id, ctx.signal);
}

export const sandboxRunCode: ToolDefinition = {
  key: "sandbox.run_code",
  label: "Running code in the VM",
  description:
    "Run a short program in your own private Linux VM and get back what it printed. Use it to " +
    "calculate, analyse data, transform files, or test code. Languages: python (python3 with the " +
    "standard library; pip install works) and bash. Files you save under /home/user stay " +
    "between runs. The program can reach the internet. It runs for at most 90 seconds. Print " +
    "the results you need: only stdout and stderr come back.",
  risk: "write",
  runsIn: "sandbox",
  untrustedOutput: true,
  timeoutMs: RUN_TIMEOUT_MS + VM_TOOL_TIMEOUT_MS,
  parameters: {
    type: "object",
    properties: {
      language: { type: "string", enum: Object.keys(LANGUAGES), description: "python or bash." },
      code: { type: "string", description: "The whole program.", maxLength: 20_000 },
    },
    required: ["language", "code"],
    additionalProperties: false,
  },
  summarise(args) {
    const language = String(args.language ?? "");
    return {
      summary: `Run ${language || "code"} in this agent's VM`,
      details: [{ label: "Code", value: clip(String(args.code ?? ""), 4_000) }],
    };
  },
  async execute(ctx, args): Promise<ToolResult> {
    const language = String(args.language) as Language;
    const spec = LANGUAGES[language];
    if (!spec) return { error: `"${String(args.language)}" isn't available in the VM. Use python or bash.` };

    const got = await vmFor(ctx);
    if ("error" in got) return got;

    // The program goes in a file rather than on a command line: no quoting to get wrong.
    // Every path here is ours, made from a random id; nothing the model wrote is in a command.
    const id = crypto.randomUUID().slice(0, 8);
    const file = `${HOME}/.omnix/run-${id}.${spec.file}`;
    const log = `${HOME}/.omnix/run-${id}.log`;
    const exit = `${HOME}/.omnix/run-${id}.exit`;
    await got.vm.files.write(file, String(args.code));

    // So the user can watch it on the live screen. Never in the way of the run itself.
    await showInTerminal(got.vm, { file, log, exit, language });

    // stdout and stderr stay separate for the model, and are also copied to the log the
    // terminal follows; the exit code is kept (pipefail) and written for the terminal too.
    const command =
      `set -o pipefail; { ${spec.command} '${file}' 2> >(tee -a '${log}' >&2); } | tee -a '${log}'; ` +
      `CODE=$?; echo $CODE > '${exit}'; exit $CODE`;

    const started = Date.now();
    try {
      const result = await got.vm.commands.run(command, {
        cwd: HOME,
        timeoutMs: RUN_TIMEOUT_MS,
        signal: ctx.signal,
      });
      return {
        output: {
          exitCode: result.exitCode,
          stdout: clip(result.stdout),
          stderr: clip(result.stderr),
          seconds: Math.round((Date.now() - started) / 100) / 10,
        },
      };
    } catch (error) {
      // A program that fails is a result, not a tool failure: the model needs its stderr.
      if (error instanceof CommandExitError) {
        return {
          output: {
            exitCode: error.exitCode,
            stdout: clip(error.stdout),
            stderr: clip(error.stderr),
            seconds: Math.round((Date.now() - started) / 100) / 10,
          },
        };
      }
      if (Date.now() - started >= RUN_TIMEOUT_MS - 1000) {
        return { error: `The program ran longer than ${RUN_TIMEOUT_MS / 1000}s and was stopped.` };
      }
      throw error;
    }
  },
};

export const sandboxWriteFile: ToolDefinition = {
  key: "sandbox.write_file",
  label: "Saving a file in the VM",
  description:
    "Save a text file in your VM, under /home/user. Creates folders as needed and replaces a " +
    "file that is already there. Use it to keep notes, data or code for later runs.",
  risk: "write",
  runsIn: "sandbox",
  timeoutMs: VM_TOOL_TIMEOUT_MS,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "e.g. notes.md or /home/user/data/out.csv", maxLength: 500 },
      content: { type: "string", description: "The whole file.", maxLength: 200_000 },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  summarise(args) {
    const target = homePath(args.path);
    return {
      summary: `Save a file in this agent's VM: ${"path" in target ? target.path : String(args.path)}`,
      details: [{ label: "Content", value: clip(String(args.content ?? ""), 4_000) }],
    };
  },
  async execute(ctx, args) {
    const target = homePath(args.path);
    if ("error" in target) return target;
    const got = await vmFor(ctx);
    if ("error" in got) return got;
    const content = String(args.content ?? "");
    await got.vm.files.write(target.path, content);
    return { output: { saved: target.path, characters: content.length } };
  },
};

export const sandboxReadFile: ToolDefinition = {
  key: "sandbox.read_file",
  label: "Reading a file in the VM",
  description: "Read a text file from your VM, under /home/user.",
  risk: "read",
  runsIn: "sandbox",
  untrustedOutput: true,
  timeoutMs: VM_TOOL_TIMEOUT_MS,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "e.g. notes.md or /home/user/data/out.csv", maxLength: 500 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const target = homePath(args.path);
    if ("error" in target) return target;
    const got = await vmFor(ctx);
    if ("error" in got) return got;
    if (!(await got.vm.files.exists(target.path))) return { error: `There is no file at ${target.path}.` };
    const text = await got.vm.files.read(target.path);
    return { output: { path: target.path, text: clip(text, 20_000) } };
  },
};

export const sandboxListFiles: ToolDefinition = {
  key: "sandbox.list_files",
  label: "Looking at files in the VM",
  description: "List what is in a folder of your VM, under /home/user. Leave path out for /home/user itself.",
  risk: "read",
  runsIn: "sandbox",
  timeoutMs: VM_TOOL_TIMEOUT_MS,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "A folder, e.g. data. Defaults to /home/user.", maxLength: 500 },
    },
    additionalProperties: false,
  },
  async execute(ctx, args) {
    const target = homePath(args.path ?? HOME);
    if ("error" in target) return target;
    const got = await vmFor(ctx);
    if ("error" in got) return got;
    if (!(await got.vm.files.exists(target.path))) return { error: `There is no folder at ${target.path}.` };
    const entries = await got.vm.files.list(target.path);
    return {
      output: {
        path: target.path,
        entries: entries
          // Our own scratch folder isn't the agent's business.
          .filter((entry) => entry.name !== ".omnix")
          .slice(0, 200)
          .map((entry) => ({ name: entry.name, type: entry.type, size: entry.size })),
      },
    };
  },
};

export const sandboxOpenBrowser: ToolDefinition = {
  key: "sandbox.open_browser",
  label: "Opening a page in the VM's browser",
  description:
    "Open a web page in your VM's browser, where the user can watch it on the live screen. Use " +
    "it when the user wants to see a page, or to show your work. It returns the window title, " +
    "not the page text: to read a page use web.fetch, or fetch it with code in the VM.",
  risk: "read",
  runsIn: "sandbox",
  untrustedOutput: true,
  timeoutMs: VM_TOOL_TIMEOUT_MS,
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "An http or https address.", maxLength: 2_000 },
    },
    required: ["url"],
    additionalProperties: false,
  },
  async execute(ctx, args) {
    let url: URL;
    try {
      url = new URL(String(args.url));
    } catch {
      return { error: `"${String(args.url)}" isn't a web address.` };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "Only http and https pages can be opened." };

    const got = await vmFor(ctx);
    if ("error" in got) return got;
    await got.vm.open(url.toString());
    // Give the browser a moment to show the page, then report what it says it opened.
    await got.vm.wait(4_000);
    let title: string | null = null;
    try {
      title = await got.vm.getWindowTitle(await got.vm.getCurrentWindowId());
    } catch {
      // No window focused yet: still opening.
    }
    return { output: { opened: url.toString(), windowTitle: title ?? "(still loading)" } };
  },
};

export const SANDBOX_TOOLS = [sandboxRunCode, sandboxWriteFile, sandboxReadFile, sandboxListFiles, sandboxOpenBrowser];
