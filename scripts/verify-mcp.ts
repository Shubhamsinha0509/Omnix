/**
 * Phase 5 verification: the MCP layer, checked against the real database and — with
 * `--live` — the real servers, as far as it can be without a user's account.
 *
 *   npm run verify:mcp
 *   npm run verify:mcp -- --live
 *
 * `--live` walks RFC 9728 discovery and dynamic client registration against Notion's and
 * Atlassian's servers and builds a consent URL. It needs no credentials, because
 * registering is unauthenticated: that is the point of D48. It does create (or re-use) a
 * real client registration with those servers, stored in `mcp_clients`.
 *
 * What it cannot check is anything past the consent screen — the code exchange,
 * `tools/list`, `tools/call`, refresh. Those need somebody to sign in; see
 * docs/08-roadmap.md#what-is-verified-and-what-isnt.
 *
 * Node has no tsconfig-paths support, so the "@/" alias is resolved by a loader hook
 * registered below before any app module is imported. Every import of one is therefore
 * dynamic, inside `main()`.
 */
import { createRequire, register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The alias hook has to be in place before any "@/" module is imported, which is why
// every import of one below is dynamic, inside `main()`.
register(pathToFileURL(path.join(import.meta.dirname, "ts-alias-hook.mjs")));

const require = createRequire(import.meta.url);
require("@next/env").loadEnvConfig(path.resolve(import.meta.dirname, ".."), true, { info() {}, error() {} });

const live = process.argv.includes("--live");

/** The parts of the SDK's stored discovery state these checks look at. */
type Discovery = {
  authorizationServerUrl?: string;
  authorizationServerMetadata?: { issuer?: string };
};

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: unknown, detail?: unknown) {
  if (condition) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL ${name}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

function section(title: string) {
  console.log(`\n== ${title}`);
}

async function main() {
  const servers = await import("@/lib/mcp/servers");
  const { validateOpenArgs, checkToolArgs } = await import("@/lib/tools/schema");
  const store = await import("@/lib/mcp/store");
  const toolsModule = await import("@/lib/mcp/tools");
  const { db, mcpClients, mcpFlows, mcpToolCache, users, agents } = await import("@/db");
  const { eq } = await import("drizzle-orm");

  section("Allow-list (D48, D49)");
  const ids = servers.MCP_SERVERS.map((s) => s.id);
  check("three servers", servers.MCP_SERVERS.length === 3, ids);
  check("ids are unique", new Set(ids).size === ids.length);
  check("every url is https", servers.MCP_SERVERS.every((s) => s.url.startsWith("https://")));
  check("every server asks for explicit scopes", servers.MCP_SERVERS.every((s) => s.scopes.length > 0));
  check("notion registers dynamically", servers.getMcpServer("notion")!.registration.mode === "dynamic");
  check("jira registers dynamically", servers.getMcpServer("jira")!.registration.mode === "dynamic");
  check("slack is preregistered", servers.getMcpServer("slack")!.registration.mode === "preregistered");
  check("an unknown id is not a server", servers.getMcpServer("evilcorp") === undefined);
  check("provider round-trips", servers.mcpServerId(servers.mcpProvider("notion")) === "notion");
  check("a non-mcp provider has no server id", servers.mcpServerId("gmail") === null);
  check("gmail is not an mcp server", servers.serverForProvider("gmail") === undefined);

  section("Configuration gates");
  delete process.env.SLACK_CLIENT_ID;
  delete process.env.SLACK_CLIENT_SECRET;
  const slack = servers.getMcpServer("slack")!;
  check("slack is not configured without env", servers.isMcpServerConfigured(slack) === false);
  check("slack has no credentials without env", servers.preregisteredClient(slack) === null);
  process.env.SLACK_CLIENT_ID = "123.456";
  process.env.SLACK_CLIENT_SECRET = "s3cret";
  check("slack is configured with env", servers.isMcpServerConfigured(slack) === true);
  check("slack credentials come from env", servers.preregisteredClient(slack)?.clientId === "123.456");
  delete process.env.SLACK_CLIENT_ID;
  delete process.env.SLACK_CLIENT_SECRET;
  check("notion needs no configuration", servers.isMcpServerConfigured(servers.getMcpServer("notion")!) === true);

  section("Reviewed read-only lists (D10)");
  const notion = servers.getMcpServer("notion")!;
  const jira = servers.getMcpServer("jira")!;
  check("notion-search is a reviewed read", servers.isReviewedReadOnly(notion, "notion-search"));
  check("notion-create-pages is not", !servers.isReviewedReadOnly(notion, "notion-create-pages"));
  check("notion-delete-pages is not", !servers.isReviewedReadOnly(notion, "notion-delete-pages"));
  check("getJiraIssue is a reviewed read", servers.isReviewedReadOnly(jira, "getJiraIssue"));
  check("executeRead is a reviewed read", servers.isReviewedReadOnly(jira, "executeRead"));
  check("executeWrite is NOT", !servers.isReviewedReadOnly(jira, "executeWrite"));
  check("executeDestructive is NOT", !servers.isReviewedReadOnly(jira, "executeDestructive"));
  check("createJiraIssue is NOT", !servers.isReviewedReadOnly(jira, "createJiraIssue"));
  check("deleteJiraIssue is NOT", !servers.isReviewedReadOnly(jira, "deleteJiraIssue"));
  check("slack has no reviewed reads yet", slack.readOnlyTools.length === 0);
  check(
    "an unknown tool name is never a read",
    !servers.isReviewedReadOnly(notion, "notion-search-but-evil"),
  );

  section("Loose argument checking (nothing dropped)");
  const schema = { type: "object", properties: { page: {} }, required: ["page"] };
  check("a non-object is refused", validateOpenArgs(schema, "hello").ok === false);
  check("an array is refused", validateOpenArgs(schema, [1]).ok === false);
  check("a missing required field is refused", validateOpenArgs(schema, {}).ok === false);
  const nested = validateOpenArgs(schema, {
    page: "p1",
    // Neither of these is declared in `properties`; both must survive.
    filter: { and: [{ property: "Status", select: { equals: "Done" } }] },
    deep: [{ a: [1, 2, { b: true }] }],
  });
  check("undeclared properties survive", nested.ok && "filter" in nested.value && "deep" in nested.value);
  check(
    "nested structure is untouched",
    nested.ok &&
      JSON.stringify((nested.value as Record<string, unknown>).filter) ===
        JSON.stringify({ and: [{ property: "Status", select: { equals: "Done" } }] }),
  );
  check(
    "an enormous argument object is refused",
    validateOpenArgs(schema, { page: "p", blob: "x".repeat(70_000) }).ok === false,
  );
  check(
    "checkToolArgs uses the loose path for an mcp tool",
    checkToolArgs(
      { parameters: { type: "object", properties: {} }, openParameters: schema },
      { page: "p1", extra: 1 },
    ).ok === true,
  );
  const strict = checkToolArgs({ parameters: { type: "object", properties: {} } }, { extra: 1 });
  check(
    "checkToolArgs still drops extras for a built-in tool",
    strict.ok && Object.keys(strict.value).length === 0,
  );

  section("Client registrations (encrypted, shared by issuer)");
  const issuer = `https://verify.example/${Date.now()}`;
  await store.saveRegistration({
    issuer,
    serverId: "notion",
    clientId: "client-abc",
    clientSecret: "shhh-secret",
    info: { grant_types: ["authorization_code"] },
  });
  const loaded = await store.getRegistration(issuer);
  check("a registration round-trips", loaded?.clientId === "client-abc");
  check("the secret decrypts", loaded?.clientSecret === "shhh-secret");
  check("the rest of the response is kept", (loaded?.info as { grant_types?: string[] })?.grant_types?.[0] === "authorization_code");
  const [rawRow] = await db.select().from(mcpClients).where(eq(mcpClients.issuer, issuer));
  check("the secret is not stored in the clear", !rawRow.clientSecretEnc!.includes("shhh-secret"));
  check("the ciphertext is versioned", rawRow.clientSecretEnc!.startsWith("v1:"));
  const { decrypt } = await import("@/lib/crypto");
  let wrongAadFailed = false;
  try {
    decrypt(rawRow.clientSecretEnc!, "mcp-client:https://somewhere-else");
  } catch {
    wrongAadFailed = true;
  }
  check("the secret won't decrypt under another issuer", wrongAadFailed);
  await store.saveRegistration({ issuer, serverId: "notion", clientId: "client-xyz", info: {} });
  const reRegistered = await store.getRegistration(issuer);
  check("re-registering updates the same row", reRegistered?.clientId === "client-xyz");
  check("a dropped secret reads as null", reRegistered?.clientSecret === null);
  await store.forgetRegistration(issuer);
  check("forgetting it leaves nothing", (await store.getRegistration(issuer)) === null);

  section("Connect flows are single-use (PKCE)");
  const [someUser] = await db.select().from(users).limit(1);
  if (!someUser) {
    check("a user exists to test flows with", false, "no users in the database");
  } else {
    const state = `verify-${Date.now()}`;
    await store.saveFlow(state, {
      userId: someUser.id,
      serverId: "notion",
      codeVerifier: "verifier-123",
      discovery: { authorizationServerUrl: "https://mcp.notion.com" },
      returnTo: "/workspace/integrations",
    });
    const wrongUser = await store.claimFlow(someUser.id + 99_999, state);
    check("another user cannot claim the flow", wrongUser === null);
    const claimed = await store.claimFlow(someUser.id, state);
    check("the owner claims it", claimed?.codeVerifier === "verifier-123");
    check("the discovery state comes back", (claimed?.discovery as { authorizationServerUrl?: string })?.authorizationServerUrl === "https://mcp.notion.com");
    check("returnTo is preserved", claimed?.returnTo === "/workspace/integrations");
    const again = await store.claimFlow(someUser.id, state);
    check("a second claim gets nothing", again === null);

    const [stillThere] = await db.select().from(mcpFlows).where(eq(mcpFlows.state, state));
    check("the row is gone after claiming", stillThere === undefined);

    // An expired flow is refused even though the row is there.
    const oldState = `verify-old-${Date.now()}`;
    await db.insert(mcpFlows).values({
      state: oldState,
      userId: someUser.id,
      serverId: "notion",
      codeVerifierEnc: (await import("@/lib/crypto")).encrypt("v", `mcp-flow:${someUser.id}:${oldState}`),
      discovery: {},
      returnTo: "/workspace",
      expiresAt: new Date(Date.now() - 60_000),
    });
    check("an expired flow is refused", (await store.claimFlow(someUser.id, oldState)) === null);
    check("purging reports what it cleared", (await store.purgeExpiredFlows()) >= 0);
  }

  section("Tool cache and tool definitions");
  const [agent] = await db.select().from(agents).limit(1);
  const { saveConnection, deleteConnection } = await import("@/lib/integrations/connections");

  if (!someUser) {
    check("a user exists to test the cache with", false);
  } else {
    const connection = await saveConnection({
      userId: someUser.id,
      provider: servers.mcpProvider("notion"),
      kind: "mcp",
      serverUrl: notion.url,
      accountLabel: "Notion (verification)",
      accessToken: "access-token-for-verification",
      refreshToken: "refresh-token-for-verification",
      scopes: ["default"],
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const sample = [
      { name: "notion-search", description: "Search Notion.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
      { name: "notion-create-pages", title: "Create pages", description: "Creates pages. Second sentence.", inputSchema: { type: "object", properties: { pages: { type: "array" } } } },
      { name: "notion-delete-pages", description: "Deletes pages.", inputSchema: { type: "object", properties: {} } },
      // Unrepresentable on the wire: dropped rather than mangled.
      { name: "bad/name:here", description: "Should be dropped.", inputSchema: { type: "object", properties: {} } },
      { name: `x${"y".repeat(80)}`, description: "Too long.", inputSchema: { type: "object", properties: {} } },
    ];
    await db
      .insert(mcpToolCache)
      .values({ connectionId: connection.id, tools: sample, fetchedAt: new Date(), error: null })
      .onConflictDoUpdate({
        target: mcpToolCache.connectionId,
        set: { tools: sample, fetchedAt: new Date(), error: null },
      });

    const cached = await toolsModule.cachedMcpTools(connection.id);
    check("the cache reads back", cached.tools.length === 5);
    check("a fresh cache is not stale", cached.stale === false);

    const definitions = await toolsModule.mcpToolDefinitions({
      id: connection.id,
      provider: connection.provider,
    });
    const byKey = new Map(definitions.map((d) => [d.key, d]));
    check("wire-unsafe names are dropped", definitions.length === 3, definitions.map((d) => d.key));
    check("the key is server-prefixed", byKey.has("notion.notion-search"));
    check("a reviewed read is risk:read", byKey.get("notion.notion-search")!.risk === "read");
    check("an unreviewed tool is risk:write", byKey.get("notion.notion-create-pages")!.risk === "write");
    check("a delete tool is risk:write, never destructive", byKey.get("notion.notion-delete-pages")!.risk === "write");
    check("every mcp tool is marked untrusted", definitions.every((d) => d.untrustedOutput === true));
    check("the provider is the mcp provider", definitions.every((d) => d.provider === "mcp:notion"));
    check(
      "the description is attributed to the server",
      byKey.get("notion.notion-search")!.description.startsWith("From the Notion MCP server"),
    );
    // jsonb does not preserve key order, so compare structurally rather than by text.
    const passedThrough = byKey.get("notion.notion-search")!.openParameters as {
      type?: string;
      properties?: Record<string, { type?: string }>;
      required?: string[];
    };
    check(
      "the server's own schema is passed through",
      passedThrough?.type === "object" &&
        passedThrough?.properties?.query?.type === "string" &&
        JSON.stringify(passedThrough?.required) === JSON.stringify(["query"]),
      passedThrough,
    );
    check(
      "the label prefers the server's title",
      byKey.get("notion.notion-create-pages")!.label === "Create pages",
    );
    check(
      "the ui summary is one sentence",
      byKey.get("notion.notion-create-pages")!.summary === "Creates pages.",
    );
    const card = byKey.get("notion.notion-create-pages")!.summarise!({ pages: [{ title: "Q3 plan" }] });
    check("the approval card names the tool and server", card.summary === 'Run "Create pages" on Notion');
    check("the card shows the arguments", card.details?.[0]?.label === "pages");
    check(
      "the card shows the real value",
      card.details?.[0]?.value.includes("Q3 plan"),
    );

    // The staleness clock.
    await db
      .update(mcpToolCache)
      .set({ fetchedAt: new Date(Date.now() - toolsModule.TOOL_CACHE_TTL_MS - 1000) })
      .where(eq(mcpToolCache.connectionId, connection.id));
    check("an old cache reads as stale", (await toolsModule.cachedMcpTools(connection.id)).stale === true);

    if (agent && agent.userId === someUser.id) {
      const { listToolSettings, resolveAgentTools } = await import("@/lib/tools/selection");
      const settings = await listToolSettings(agent);
      const mcpSettings = settings.filter((s) => s.provider === "mcp:notion");
      check("the agent's settings page lists the mcp tools", mcpSettings.length === 3);
      check("they are named for the user", mcpSettings.every((s) => s.providerName === "Notion"));
      check("they start switched off", mcpSettings.every((s) => s.enabled === false));
      check(
        "an mcp write tool can have its approval trusted",
        mcpSettings.find((s) => s.key === "notion.notion-create-pages")!.approvalEditable === true,
      );
      const resolved = await resolveAgentTools(agent);
      check(
        "a run offers no mcp tool until one is enabled",
        resolved.every((r) => !r.tool.key.startsWith("notion.")),
      );
      check("built-in tools are still offered", resolved.some((r) => r.tool.key === "time.now"));
    } else {
      console.log("  skip agent-level checks (no agent for this user)");
    }

    await deleteConnection(someUser.id, connection.id);
    check(
      "deleting the account takes its tool cache with it",
      (await toolsModule.cachedMcpTools(connection.id)).fetchedAt === null,
    );
  }

  if (live) {
    section("Live: discovery, dynamic registration and the consent URL");
    const { startMcpAuthorization } = await import("@/lib/mcp/oauth");

    for (const id of ["notion", "jira"]) {
      const server = servers.getMcpServer(id)!;
      try {
        const started = await startMcpAuthorization({
          server,
          userId: someUser?.id ?? 1,
          returnTo: "/workspace/integrations",
        });
        const url = new URL(started.authorizationUrl);
        console.log(`  ${id}: ${url.origin}${url.pathname}`);
        check(`${id}: an authorization URL came back`, url.protocol === "https:");
        check(`${id}: PKCE challenge is on the URL`, url.searchParams.get("code_challenge_method") === "S256");
        check(`${id}: a verifier was produced`, (started.flow.codeVerifier ?? "").length > 20);
        check(`${id}: the resource indicator names the server (RFC 8707)`, url.searchParams.get("resource") === server.url);
        check(`${id}: our redirect_uri is sent`, url.searchParams.get("redirect_uri")?.endsWith("/api/connections/mcp/callback") === true);
        check(`${id}: a client_id was obtained`, (url.searchParams.get("client_id") ?? "").length > 0);
        check(`${id}: state is on the URL`, url.searchParams.get("state") === started.state);
        const scope = url.searchParams.get("scope") ?? "";
        check(`${id}: our own scopes are requested, not the server's whole list`, server.scopes.every((s) => scope.includes(s)), scope);
        check(`${id}: discovery state was recorded`, Boolean((started.flow.discovery as Discovery)?.authorizationServerUrl));
        const recordedIssuer = (started.flow.discovery as Discovery)?.authorizationServerMetadata?.issuer;
        check(`${id}: the issuer was recorded for the callback check (RFC 9207)`, Boolean(recordedIssuer), recordedIssuer);
        if (server.registration.mode === "dynamic" && recordedIssuer) {
          check(`${id}: the registration was stored`, (await store.getRegistration(recordedIssuer)) !== null);
        }
      } catch (error) {
        check(`${id}: connect flow starts`, false, (error as Error).message);
      }
    }
  } else {
    console.log("\n(skipping live checks; pass --live to run them)");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`failed: ${failures.join("; ")}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
