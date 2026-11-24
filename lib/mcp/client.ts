import {
  Client,
  SdkHttpError,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/client";

import { McpReauthorizationRequired, runtimeAuthProvider } from "./oauth";
import type { McpServerSpec } from "./servers";

/**
 * Talking to a remote MCP server.
 *
 * One connection per unit of work, opened and closed around it. That looks wasteful next
 * to a long-lived client, and isn't: we run on serverless functions that keep nothing
 * between requests (D16), and the 2026-07-28 protocol is stateless by design, so there is
 * no session to amortise — only a token read and, for a 2025-era server, one `initialize`.
 *
 * Everything here is bounded. A server we don't control decides how long it takes to
 * answer and how much it sends back, and an agent run is a request with a user waiting at
 * the end of it (docs/04-agent-runtime.md).
 */

const CLIENT_INFO = { name: "Omnix", version: "0.1.0" };

export const MCP_LIMITS = {
  /** Opening a connection: discovery, maybe an `initialize`, and the era probe. */
  connectMs: 15_000,
  /** One `tools/list` or `tools/call`. Inside the runner's own per-tool timeout. */
  requestMs: 25_000,
  /**
   * How many tools we will take from one server.
   *
   * Notion alone publishes about sixty. A server that answered with thousands would cost
   * us a large JSON parse and a large row, so the list is truncated rather than trusted.
   */
  maxTools: 200,
};

/** A server-side failure that the model is told about and can carry on from. */
export class McpCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpCallError";
  }
}

type Session = {
  server: McpServerSpec;
  userId: number;
  connectionId: string;
  signal?: AbortSignal;
};

/**
 * Opens a connection, runs one piece of work, and closes it again.
 *
 * `versionNegotiation: { mode: "auto" }` is what lets the same code talk to all three
 * servers: it probes with `server/discover` and falls back to the 2025 `initialize`
 * handshake for a server still on the old shape — Atlassian, at the time of writing —
 * without any of that being a special case here (D47).
 */
async function withServer<T>(session: Session, work: (client: Client) => Promise<T>): Promise<T> {
  const provider = runtimeAuthProvider({
    server: session.server,
    userId: session.userId,
    connectionId: session.connectionId,
  });

  const client = new Client(CLIENT_INFO, {
    versionNegotiation: { mode: "auto" },
    // The tool list is cached by us, in a table the settings page reads too, so the
    // SDK's own in-memory cache would only duplicate it for the life of one request.
    listMaxPages: 8,
  });

  const transport = new StreamableHTTPClientTransport(new URL(session.server.url), {
    authProvider: provider,
  });

  try {
    await client.connect(transport, { timeout: MCP_LIMITS.connectMs, signal: session.signal });
    return await work(client);
  } catch (error) {
    throw translate(session.server, error);
  } finally {
    // Closing is best effort: the work is done either way, and a server that won't say
    // goodbye must not turn a successful call into a failed one.
    await client.close().catch(() => {});
  }
}

/**
 * Turns an SDK failure into something a user or a model can act on.
 *
 * The distinction that matters is "this account needs reconnecting" versus "this didn't
 * work just now": the first is a job for the user and the agent should say so, the second
 * is worth another try later.
 */
function translate(server: McpServerSpec, error: unknown): Error {
  if (error instanceof McpReauthorizationRequired) return error;
  if (error instanceof UnauthorizedError) return new McpReauthorizationRequired(server.name);

  if (error instanceof SdkHttpError) {
    const status = error.data?.status;
    if (status === 401 || status === 403) return new McpReauthorizationRequired(server.name);
    if (status === 429) {
      return new McpCallError(
        `${server.name} is rate limiting us. Wait a little before trying that again.`,
      );
    }
    return new McpCallError(`${server.name} answered ${status ?? "an error"}.`);
  }

  const message = error instanceof Error ? error.message : String(error);
  return new McpCallError(`${server.name} couldn't be reached: ${message}`);
}

/**
 * The tools a server is offering this account right now.
 *
 * A server's tool list is its own business and can change under us, which is why this is
 * fetched rather than configured — and cached by the caller rather than here.
 */
export async function listServerTools(session: Session): Promise<Tool[]> {
  return withServer(session, async (client) => {
    const { tools } = await client.listTools(undefined, {
      timeout: MCP_LIMITS.requestMs,
      signal: session.signal,
    });
    return tools.slice(0, MCP_LIMITS.maxTools);
  });
}

/** One `tools/call`. The result is handed back as the server sent it. */
export async function callServerTool(
  session: Session,
  call: { name: string; arguments: Record<string, unknown> },
): Promise<CallToolResult> {
  return withServer(session, (client) =>
    client.callTool(
      { name: call.name, arguments: call.arguments },
      { timeout: MCP_LIMITS.requestMs, signal: session.signal },
    ),
  );
}
