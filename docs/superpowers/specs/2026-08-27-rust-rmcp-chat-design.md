# Rust rmcp MCP Server + Chat Page — Design

> **Status:** the MCP half is implemented as described. The **Chat page section is
> superseded** by `2026-08-28-ai-assistant-page-design.md`, which replaced the
> single provider record with a provider → endpoint → model tree, added the
> assistant/session two-level structure, and made conversations persistent
> instead of in-memory. Everything else here — the tool set, the transports, the
> security rules — still holds.

Supersedes `2026-08-18-job-log-analysis-mcp-design.md`. That design put the MCP
server in a separate Node.js package (`mcp/`) that reached back into the Rust
app over a token-authenticated localhost HTTP bridge. This one folds the whole
thing into the Tauri binary using the official Rust SDK (`rmcp` 3.1.4), and adds
an in-app Chat page that talks to the same tools.

## Goal

1. **One codebase, one build.** No `mcp/` npm package, no `npm run mcp:build`,
   no bundled `mcp/dist` resource, no Node child process. `cargo build` produces
   everything.
2. **MCP protocol and tools in Rust**, on `rmcp` 3.1.4.
3. **A Chat page** with its own LLM provider config (name, type, API key, base
   URL, model), supporting OpenAI- and Anthropic-shaped APIs. Its MCP client
   speaks to the built-in server **in-process**.
4. **External agents** (Claude Code, Cursor, Codex, …) keep connecting over
   **Streamable HTTP** on `127.0.0.1`, exactly as today.

## Why this is a net simplification

The Node server could not touch AWS or the database itself, so every capability
it exposed had to be mirrored three times: as a Rust AWS call, as a bridge HTTP
route with request/response DTOs on both sides, and as a TypeScript client
method. `mcp_bridge.rs` is ~900 lines that exist only to let a sibling process
borrow work the app already does. A camelCase/snake_case mismatch in a single
DTO silently dropped every audit row — a class of bug that cannot occur once
the tool calls the repository function directly.

Removing the bridge also removes the bridge token, the `mcp-bridge.json` file
that publishes it to disk, orphaned-process reclamation via `lsof`/`kill`, and
the "MCP entry point not found — run npm run mcp:build" failure mode.

| | Today | After |
|---|---|---|
| Processes | app + `node mcp/dist/index.js` | app |
| Layers per tool | Rust AWS → bridge route → TS client → tool | Rust AWS → tool |
| Cross-process auth | bridge token on disk | none needed |
| Chat's MCP path | n/a | in-process, no socket |
| External agents | Streamable HTTP `:5175/mcp` | unchanged |

## Verified against rmcp 3.1.4

Both transports were compile-and-run tested before this design was written
(`src-tauri/src/mcp/spike.rs`, deleted once the real server lands):

- **Tools**: `#[tool_router]` + `#[tool]` on an inherent impl, `#[tool_handler]`
  on `impl ServerHandler`. Parameters arrive as `Parameters<T>` where
  `T: Deserialize + schemars::JsonSchema`; returning `Json<T>` publishes an
  output schema. Requires the `schemars` crate (1.2) as a direct dependency.
- **In-process**: `ServiceExt::serve` over a `tokio::io::duplex` pair — the
  server takes one half, the client the other. Confirmed `list_all_tools` and
  `call_tool` round-trip with no socket and no spawn.
- **Streamable HTTP**: `StreamableHttpService::new(factory, session_manager,
  config)` is a `tower::Service`, mounted with
  `axum::Router::route_service("/mcp", service)`. Confirmed a raw JSON-RPC
  `initialize` + `tools/call` over the wire returns the tool result.
- Features needed: `server`, `client`, `transport-streamable-http-server`,
  `transport-worker`.

Note on the "Worker" wording in the request: `WorkerTransport` is rmcp's
internal plumbing for transports that own a background task (the Streamable
HTTP *client* is built on it). For same-process client↔server wiring the
duplex-stream path above is the supported route and is what the Chat page uses.
It is in-process in the sense that matters — no port, no serialization across a
process boundary, no child process.

## Architecture

```
┌─ Tauri app (single process) ───────────────────────────────────────────┐
│                                                                        │
│  WebView (React)                                                       │
│    Chat page ──── invoke("chat_send") ──┐    MCP page ─── mcp_start/  │
│      ▲  chat:delta / chat:tool events   │                     mcp_stop │
│      └─────────────────────────────┐    │                          │   │
│                                    │    ▼                          ▼   │
│  Rust                              │  ┌──────────────────┐  ┌──────────┴──┐
│    chat/                           │  │ chat loop        │  │ http server │
│      providers.rs  SQLite + keyring│  │ reqwest→OpenAI / │  │ axum route  │
│      openai.rs / anthropic.rs  ────┘  │ Anthropic (SSE)  │  │ /mcp        │
│                                       └────────┬─────────┘  └──────┬──────┘
│                                                │ in-process        │
│    mcp/                                        ▼ (duplex)          ▼
│      server.rs   EmrMcpServer: ToolRouter ◄────────────────────────┘
│      tools/      analyze_job_failure, find_job, list_job_log_objects, …
│      analysis.rs sanitize.rs job_id.rs log_destinations.rs noise.rs
│      audit.rs    → repository::insert_mcp_audit_entry
│                                                │
│    aws/ commands/  existing AWS SDK clients ◄──┘
│    db/  SQLite + OS keyring (credentials, audit)                       │
└────────────────────────────────────────────────────────────────────────┘
         ▲ Streamable HTTP 127.0.0.1:5175/mcp
    external agents: Claude Code / Cursor / Codex / …
```

The `EmrMcpServer` handler is constructed identically for both transports, so
the Chat page and an external agent see the same tools with the same behaviour
and both write to the same audit table.

## Module layout

```
src-tauri/src/
  mcp/
    mod.rs              re-exports; EmrMcpServer construction
    server.rs           #[tool_router] impl + ServerHandler
    http.rs             StreamableHttpService on axum; start/stop
    in_process.rs       resident client for the Chat page
    audit.rs            one row per tool call → repository
    tools/
      analyze_job_failure.rs
      accounts.rs       list_accounts (LLM-safe projection)
      jobs.rs           find_job, describe_job
      logs.rs           list_job_log_objects, get_job_log_text
    analysis.rs         ← mcp/src/analysis/index.ts
    sanitize.rs         ← mcp/src/sanitize/index.ts
    job_id.rs           ← mcp/src/tools/emrJobId.ts
    log_destinations.rs ← mcp/src/tools/jobLogDestinations.ts
    noise.rs            ← filterLogNoise from analyzeJobFailure.ts
  chat/
    mod.rs
    providers.rs        provider CRUD; keys in OS keyring
    session.rs          conversation state, tool-call loop
    openai.rs           /v1/chat/completions, SSE deltas, tool_calls
    anthropic.rs        /v1/messages, SSE deltas, tool_use
  commands/
    mcp.rs              mcp_start/mcp_stop/mcp_status/list_mcp_audit_entries
    chat.rs             chat_* commands
```

Deleted: `mcp/` (whole npm package), `src-tauri/src/mcp_bridge.rs`, the
`mcp:build` script, `tauri.conf.json`'s `resources: ["../mcp/dist"]`.

## Tool set

All tools are **read-only**. No `StartJobRun`, no `CancelJobRun`, no S3 writes —
an external agent connected to this server cannot mutate AWS state.

| Tool | Purpose |
|---|---|
| `analyze_job_failure` | Unchanged contract: job id → state + controller (pod-level) evidence + Spark application evidence + candidate causes + sanitized raw log tails. Still the one-shot entry point. |
| `list_accounts` | Configured accounts as the LLM-safe projection: `id`, `name`, `region`, `isActive`, `username`. Never keys, AWS account number, or full ARN. |
| `find_job` | Locate a job id across accounts (active first), local history then AWS. Returns the job summary + which account it was found in. |
| `describe_job` | Full describe for a known account + cluster. |
| `list_job_log_objects` | The job's log objects/streams, classified controller / driver / executor. |
| `get_job_log_text` | Sanitized text of one log object or stream, with a line cap. |

Rationale for the extra read-only tools: in-process calls are nearly free, so
letting the Chat model drill down itself (list objects → read the one that looks
relevant) beats forcing every question through one monolithic tool. External
agents get the same flexibility.

`analyze_job_failure` keeps its exact current name, argument names, description
text, and JSON report shape — agent configs and prompts already in use keep
working across the rewrite.

## Ported logic and its tests

The TypeScript in `mcp/src/` is not deleted blindly; each module moves to Rust
with its test cases carried over as `#[cfg(test)]`:

| From | To | Tests |
|---|---|---|
| `sanitize/index.ts` | `mcp/sanitize.rs` | `__tests__/sanitize.test.ts` |
| `analysis/index.ts` | `mcp/analysis.rs` | `__tests__/analysis.test.ts` |
| `tools/analyzeJobFailure.ts` | `mcp/tools/analyze_job_failure.rs` | `__tests__/analyzeJobFailure.test.ts` |
| `tools/emrJobId.ts` | `mcp/job_id.rs` | (covered by the above) |
| `tools/jobLogDestinations.ts` | `mcp/log_destinations.rs` | (covered by the above) |
| `audit/*` | `mcp/audit.rs` | `__tests__/audit.test.ts` |

Two notes on fidelity:

- The sanitizer's S3-bucket rule uses a JS lookbehind (`(?<!\d)(\d{12})(?!\d)`
  for account ids). Rust's `regex` crate has no lookbehind, so these become
  explicit boundary checks or `regex::Captures` post-filtering. The test cases
  are what pin the behaviour, which is why they move first.
- `analysis.rs` is the one piece of genuinely novel logic in the old design
  (traceback extraction, deepest `Caused by`, Python traceback blocks, the
  cause-pattern table). It is a direct port — no behaviour change intended.

Adding `regex` to `Cargo.toml` is required; the app does not currently use it.

## Transport lifecycle

**In-process (Chat)** — created lazily on first chat request and then resident
for the app's lifetime: a duplex pair, `EmrMcpServer` served on one half, an
rmcp client on the other, both held in `AppState`. No port, no configuration, no
"start the server first" step. The Chat page works even with the HTTP endpoint
switched off.

**Streamable HTTP (external agents)** — unchanged UX: the MCP page's toggle and
port field call `mcp_start` / `mcp_stop`. Internally the axum server now hosts
`StreamableHttpService` at `/mcp` instead of spawning Node, so:

- No port reclamation via `lsof` — nothing outlives the app process.
- Binding still targets the exact requested port and fails loudly on collision,
  so the endpoint the UI advertises is the one that is listening.
- Stateless + `json_response` mode (as verified in the spike), matching the
  stateless behaviour the Node server had.
- `allowed_hosts` stays at rmcp's loopback default, which is the DNS-rebinding
  protection the old server did not have.

`McpStatus` keeps its shape minus the now-meaningless fields: `bridgePort`,
`pid`, and `entryPoint` go away; `running`, `mcpPort`, `endpointUrl` remain, and
`healthUrl` is dropped (the health route existed for the bridge). The MCP page's
status card and the Security card's "token-authenticated bridge" bullet are
updated accordingly — the bridge claim would be false afterwards.

## Chat page

**Provider config.** A provider is `{id, name, type: "openai" | "anthropic",
baseUrl, model, isDefault}` stored in a new `llm_providers` SQLite table. The
**API key never goes in SQLite** — it is stored in the OS keyring under the
existing `emr-management-tool` service with key `llm/{providerId}/api_key`,
reusing `aws/credentials.rs`'s keyring helpers. The frontend receives a masked
key (`sk-…abcd`) and can replace but never read it, mirroring how AWS secret
keys are already handled.

`baseUrl` defaults to `https://api.openai.com/v1` and
`https://api.anthropic.com/v1`, and is editable so OpenAI-compatible gateways
and self-hosted endpoints work.

**Where the LLM call happens: Rust.** `reqwest` is already a dependency. Keeping
the call in Rust means the API key never enters the WebView, which is the same
rule already enforced for AWS credentials, and it puts the tool-call loop on the
same side as the in-process MCP client — no IPC round-trip per tool call.

**The loop**, in `chat/session.rs`:

1. Build the request: conversation history + tool definitions from
   `client.list_all_tools()`, translated to the provider's schema (OpenAI
   `tools[].function`, Anthropic `tools[]`).
2. POST with `stream: true`; parse SSE deltas.
3. Emit each text delta as a `chat:delta` Tauri event so the UI streams.
4. On a tool call, emit `chat:tool` (name + arguments), invoke it through the
   in-process MCP client, emit the result, append it to the history, and loop
   from step 1.
5. Stop when the model returns without a tool call. Cap the rounds so a
   misbehaving model cannot loop forever.

Tool results are already sanitized by the MCP layer, so what reaches the model
is the same text an external agent would receive. Conversations are in-memory
for v1 — no chat history table.

**UI.** A new `chat` page in `pageMeta.ts` and `AppShell.tsx`: provider
selector + settings dialog, message list with streaming assistant text, and
collapsible tool-call steps showing arguments and results. Tool activity stays
visible rather than hidden, so a user can see which AWS reads the model
performed — the same transparency the Audit tab provides for external agents.

## Security

Unchanged rules, one of them now structurally enforced:

- **AWS credentials never reach the LLM.** They stay in the AWS SDK clients.
  `list_accounts` exposes only the LLM-safe projection.
- **LLM API keys never reach the WebView.** Keyring-backed, masked in the UI.
- **All log content is sanitized** before it leaves a tool — ARNs, bucket names,
  account ids, IPs, hostnames redacted.
- **Loopback only.** The HTTP endpoint binds `127.0.0.1` and rmcp validates the
  `Host` header against loopback.
- **Read-only tools.** No AWS mutation is reachable through MCP.
- **Every tool call is audited** to the `mcp_audit` table — now by a direct
  repository call rather than an HTTP POST that could fail silently. Chat-page
  calls are audited too, with the client recorded as the chat session.

One deliberate new outbound flow: the Chat page sends conversation content and
tool results to the configured LLM provider. That is the point of the feature,
but it is worth stating plainly in the UI, since until now this app sent
**nothing** anywhere except AWS. The Chat page carries a note to that effect,
and no provider is configured by default.

## Migration order

1. Port the pure logic (sanitize, analysis, job_id, log_destinations, noise)
   with tests. Nothing wired up yet; tests prove parity with the TS versions.
2. Build `EmrMcpServer` with `analyze_job_failure` over the existing Rust AWS
   code paths; add the read-only tools.
3. Serve it over Streamable HTTP; rewrite `mcp_start`/`mcp_stop`; update
   `McpStatus` and the MCP page.
4. Delete `mcp/`, `mcp_bridge.rs`, the bridge-info plumbing, the `mcp:build`
   script, and the `resources` bundle entry.
5. Add the in-process client, provider config, and the chat loop.
6. Add the Chat page.

Steps 1–4 are a like-for-like replacement: after step 4 an existing Claude Code
config pointed at `http://127.0.0.1:5175/mcp` must keep working unchanged, with
identical `analyze_job_failure` output. That is the acceptance test for the
migration half, independent of the Chat feature.
