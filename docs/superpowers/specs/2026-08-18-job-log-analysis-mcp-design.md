# Job Log Analysis MCP Server — Design

## Goal

Build a standalone **MCP server** that any general-purpose agent tool (Claude Code, Claude Desktop, Cursor, VS Code AI, etc.) can connect to and, given an **EMR on EKS job id**, retrieve **simplified logs** and **analyze the root cause of failures**.

The MCP is a **read-only projection of the Tauri desktop app**: every capability it exposes already exists in the app. It reuses the app's account/credential store and its log-processing services, with no new AWS or log-reading logic invented.

Out of scope for v1: job submission, job cancellation, S3 file editing. v1 is **read-only log intelligence for a job id**, scoped to the desktop app's configured accounts.

## Context

The desktop app already contains every piece of log logic this MCP needs. Reuse, don't rewrite:

- **AWS credential + account resolution**: `src-tauri/src/aws/runtime.rs` (`runtime_for_context`) and `credentials.rs` — per-account SDK client, system keyring + local-file fallback, SQLite account store.
- **CloudWatch log streams + events**: `src-tauri/src/commands/logs.rs` — `list_job_log_streams`, `get_job_logs` (default log group `/aws/emr-containers/jobs/{jobId}`, pagination, JSON-normalized entries, level inference).
- **S3 log objects**: `src-tauri/src/commands/s3.rs` + `logs.rs` — read S3 log prefixes when EMR logs go to S3.
- **Log tree / stream classification** (driver / executor / controller): `src/services/emrLogTree.ts`.
- **Destination resolution** from a job: `src/services/jobLogDestinations.ts` — computes CloudWatch log group / stream prefix and S3 prefix from the job's monitoring config.
- **Noise filtering** (the "simplified log" core): `src/services/logNoiseFilter.ts`.
- **Semantic parsing** (level extraction, ETL step markers): `src/services/logSemanticHighlight.ts`.
- **Job state**: `src/services/jobRunState.ts`, `emr.rs` `DescribeJobRun`.
- **Error model**: `src-tauri/src/error.rs` — `AppError` maps AWS SDK errors to a structured kind/code/message.

### Gap between app and MCP

| App capability | MCP gap |
|---|---|
| Log reading via Tauri commands | No Tauri process boundary — MCP is its own Node process owning its own AWS client |
| "Analyze root cause" | Does **not** exist anywhere — this is the net-new logic the MCP adds (extract error section + heuristic causes) |

Everything else (account store, credentials, log services) is **reused**, not reimplemented.

## Decisions (confirmed)

| Topic | Choice |
|-------|--------|
| Runtime | **Node.js (TypeScript)** — reuses the existing TS log services verbatim |
| Transport | **SSE + Streamable HTTP** on `localhost:<port>` (no stdio; port configurable, default `5175`) |
| Port collision | Start at configured port, **+1 until a free port is found**; log + expose the resolved port/URL |
| AWS auth | Same store as the app: **SQLite account table** + **OS keyring** (service `emr-management-tool`) with **local-file fallback** (`emr-management-tool.credentials.json`) |
| Account scoping | `accountId` is optional per-tool; **defaults to the desktop app's active account** (`aws_accounts.is_active = 1`). All operations scoped to that account unless explicitly overridden |
| `virtualClusterId` | **Required** on every job/log tool — EMR `DescribeJobRun` mandates it, and the same `jobId` can exist under different clusters |
| Tools (v1) | `list_accounts`, `describe_job`, `list_job_logs`, `get_simplified_logs`, `analyze_job_failure`, `search_logs` |
| "Simplified log" | Reuse `filterLogNoise` + semantic parse → plain text with hidden-count report; **S3 preferred over CloudWatch**, whichever destination exists |
| "Analyze failure" | Deterministic heuristics only (extract ERROR/WARN tail + Spark traceback + candidate causes); **no LLM inside the tool** — the calling agent does final judgment on the evidence |
| **Credential isolation** | **AWS credentials NEVER enter the tool result — they stay in the `@aws-sdk` client at process memory, never serialized, never returned to any tool caller. See [Credential isolation principle](#credential-isolation-principle) below.** |
| **Log sanitization** | Before any log content is returned to the caller, run through a sanitizer that redacts sensitive patterns (S3 bucket names, account IDs, ARNs, IP addresses, etc.). See [Log sanitization](#log-sanitization) below. |
| **Audit trail** | Every MCP tool invocation is recorded in a local structured log file with full request/response (tool name, args, result size, timing). A companion `mcp-log-viewer` subcommand or Tauri panel lets developers inspect the full interaction history. See [Audit trail for developers](#audit-trail-for-developers) below. |
| Security | Output truncated to a sane cap; secrets never returned; read-only IAM scoping documented; localhost-only binding |

## Architecture

```
        +----------------------------------------------------------+
        |  Agent tool (Claude Code / Desktop / Cursor / ...)       |
        |  talks MCP over HTTP (SSE or Streamable)                 |
        +----------------------------+-----------------------------+
                                     | http://localhost:<port>
        +----------------------------v-----------------------------+
        |  MCP Server (Node/TS)  - one process, localhost:<port>   |
        |  +---------------------------------------------------+  |
        |  |  Tools layer: list_accounts, describe_job,        |  |
        |  |  get_simplified_logs, analyze_job_failure, ...    |  |
        |  +-----------------------+---------------------------+  |
        |                          |                             |
        |  +-----------------------+---------------------------+  |
        |  |  Log services (REUSE ts/): logNoiseFilter,        |  |
        |  |  logSemanticHighlight, emrLogTree,                |  |
        |  |  jobLogDestinations                                |  |
        |  +-----------------------+---------------------------+  |
        |                          |                             |
        |  +-----------------------+---------------------------+  |
        |  |  AWS client layer (port of runtime.rs + logs.rs) |  |
        |  |  @aws-sdk/client-emr-containers / cloudwatch-logs|  |
        |  |  / s3 / sts                                              |  |
        |  +-----------------------+---------------------------+  |
        |                          |                             |
        |  +-----------------------+---------------------------+  |
        |  |  App store reader: SQLite (better-sqlite3)          |  |
        |  |  aws_accounts table + OS keyring (keyring)          |  |
        |  |  + local credentials.json fallback                 |  |
        +--+-----------------------------------------------------+
                                     |
                             AWS (EMR on EKS, CloudWatch, S3)
```

## MCP Tool Surface

All tools are read-only. Every job/log tool takes:

- `jobId` — required.
- `virtualClusterId` — **required** (EMR API mandate; disambiguates duplicate job ids).
- `accountId` — optional; defaults to the desktop app's **active account**.
- `region` — optional; defaults to the resolved account's region.

### 1. `list_accounts`
- **Args**: none
- **Returns**: accounts configured in the desktop app, read from the SQLite `aws_accounts` table: `{ id, name, region, isActive }` — name only, no credential material of any kind.
- **Why**: lets an agent orient itself ("which account is the failing job in?"). No AWS CLI / env scanning — the MCP's universe is exactly what the app has configured. The agent only needs enough to identify the right account by name; account resolution and credential handling happen server-side.

### 2. `describe_job`
- **Args**: `jobId`, `virtualClusterId`, `accountId?`, `region?`
- **Returns**: `JobRunSummary` — state, exit/error details, monitoring config (which feeds destination resolution).
- **Reuses**: port of `DescribeJobRun` from `emr.rs`.

### 3. `list_job_logs`
- **Args**: `jobId`, `virtualClusterId`, `accountId?`, `region?`, `logType?` (`driver`/`executor`/`controller`), `limit?`, `nextToken?`
- **Returns**: the EMR log tree (driver / executor / controller sections + streams), so the agent can pick a stream to read.
- **Reuses**: `list_job_log_streams` + `emrLogTree.buildEmrLogTree`.

### 4. `get_simplified_logs`  ← core ask
- **Args**: `jobId`, `virtualClusterId`, `accountId?`, `region?`, `logType?` (default `driver`), `stream?` (default `stderr`), `maxChars?` (default 512_000), `includeNoise?` (default false)
- **Returns**: `{ text, hiddenCount, truncated, totalCharacters, entries, source }` — the **noise-filtered** log text (WARN/ERROR/DEBUG/TRACE kept; INFO noise dropped), a hidden-line count, and which destination it came from (`"s3"` | `"cloudwatch"`).
- **Pipeline**: resolve destination (`jobLogDestinations`) → fetch from **S3 first, then CloudWatch** (whichever exists) → `filterLogNoise` → `formatCloudWatchMessages` + `truncateLogTextForDisplay`.
- **Why**: "by job id, get simplified logs" — done, with the same normalization the GUI shows a human.

### 5. `analyze_job_failure`  ← core ask
- **Args**: `jobId`, `virtualClusterId`, `accountId?`, `region?`, `logType?` (default `driver`), `stream?` (default `stderr`)
- **Returns**: a structured failure report (evidence only, no LLM):
  - job state / exit code / error message (from `describe_job`)
  - tail of the simplified log (last N ERROR/WARN lines)
  - extracted Spark exception / stack-trace block (`Caused by:`, `Exception in thread`, `at …(` frames)
  - `candidateCauses`: heuristic list matched from known patterns (OOM, permission, missing class, bad SQL, data skew, cancelled, script exit-code)
  - the raw evidence lines, so the agent can reason further
- **Pipeline**: `describe_job` + `get_simplified_logs` → `logSemanticHighlight` segment parse → error-section extractor → pattern matcher.
- **Why**: "analyze the error cause". Heuristics keep it deterministic and cheap; the calling agent does the final judgment on top of the evidence.

### 6. `search_logs`
- **Args**: `jobId`, `virtualClusterId`, `accountId?`, `region?`, `query`, `logType?`, `limit?`
- **Returns**: matching log entries with timestamps + stream.
- **Reuses**: CloudWatch `filterPattern` + `logSearch.ts` client-side refinement. Note: CloudWatch `filterPattern` is not regex — it does exact-word / AND / NOT matching, so broad free-text queries fall back to client-side filtering.

### Not in v1 (future)
- `submit_job` / `cancel_job` — write-path.
- `browse_s3` / `read_s3_object` — S3 browsing beyond the job log prefix.

## Simplified-log pipeline (detail)

The heart of `get_simplified_logs`, with **S3 preferred over CloudWatch**:

```
jobId + virtualClusterId + account
        │
        ▼
resolveJobLogDestinations(describe_job(jobId))
   └─ S3:         { bucket, prefix }              (if monitoringConfig.logUri set)
   └─ CloudWatch: { logGroupName, streamNamePrefix }
        │
        ▼
fetchLogEntries(...)      // S3 first, then CloudWatch:
        │                 //   S3:   s3.rs GetObject + pagination + JSON-normalize
        │                 //   CW:   logs.rs get_job_logs, default group /aws/.../{id}
        ▼
pick default stream        // emrLogTree.pickDefaultLogItem: driver/stderr first
        │
        ▼
filterLogNoise(joinedText) // REUSE src/services/logNoiseFilter.ts verbatim
        │                  //   drops SLF4J: + Spark INFO noise loggers
▼
truncateLogTextForDisplay   // REUSE logDisplay.ts, MAX_LOG_VIEW_CHARACTERS
        │
        ▼
{ text, hiddenCount, truncated, totalCharacters, entries, source }
```

Key property: **the same JSON-normalization + noise filter the app already ships** is what the agent sees, so an agent's analysis is consistent with what a human sees in the GUI. `source` tells the agent where the logs came from.

## Failure-analysis extractor (detail)

Net-new. Given simplified driver/stderr text:

1. Split into semantic segments (`logSemanticHighlight.segmentLogText`).
2. Keep `ERROR` + `WARN` lines; keep `-- stepId=N` ETL markers for step context.
3. Find traceback blocks: lines starting with `Caused by:`, `Exception in thread "…"`, `at …(` stack frames, `... N more`.
4. Collect `ETLLogger` error lines (the app already highlights these specially).
5. Heuristic cause matcher against keywords:

| Keyword pattern | Candidate cause |
|---|---|
| `OutOfMemoryError`, `Container killed by YARN`, `Memory limit exceeded` | OOM / executors killed |
| `Permission denied`, `AccessDenied`, `NoSuchBucket`, `AccessDeniedException` | S3/IAM permission |
| `ClassNotFoundException`, `NoClassDefFoundError`, `No such file or class` | missing jar / classpath |
| `InvalidInputException`, `ParseException`, `AnalysisException`, `mismatched input` | bad SQL / bad script |
| `Caused by: org.apache.spark.SparkException: Job aborted` | stage failure (surface the deepest `Caused by`) |
| `command not found`, `Non-zero exit`, `Script returned exit code` | script/exit-code failure |
| `CANCELLED` / `CancelJobRun` | cancelled by user |

Returns the **deepest** `Caused by` (last one) as the top candidate — that is where Spark "real" errors hide.

## Credential isolation principle

**This is a hard architectural constraint, not a best-effort note.**

> **AWS credentials (access key, secret access key, session token) MUST NEVER be returned in any tool result. They are loaded into the `@aws-sdk` client at the process level, NEVER serialized, and NEVER exposed to any tool caller.**

Concretely:

1. **Account listing (`list_accounts`) returns only `name` + `region`** — no credential material of any kind, not even a masked key ID. The agent only needs to identify the right account by name; credential resolution is entirely server-side.
2. **The `@aws-sdk` credential provider chain** is configured once at process startup (or per-account). The SDK manages the credentials internally; the MCP code never touches the raw credential strings.
3. **No tool argument** accepts a credential value. There is no "override credentials" parameter.
4. **No error message** includes a credential value. AWS SDK errors are mapped through the same `AppError` pattern the app uses (service + code + message, no credential leak).
5. **The keyring / credentials file reader** exists only to build the `@aws-sdk` static credentials provider. After the `SdkConfig` is created, the raw credential strings are dropped from the MCP's memory scope.

This mirrors the desktop app's existing boundary: `AwsAccountSummary` only exposes `access_key_id_masked`, and credentials are handled entirely in Rust's `runtime.rs` / `credentials.rs` — the frontend never sees raw keys.

The MCP reuses the desktop app's store exactly. It does **not** scan AWS CLI profiles or env vars.

### Account metadata — SQLite
- Reads `app_data_dir()/emr-management-tool.sqlite`, table `aws_accounts(id, name, region, is_active, payload)`.
- Library: `better-sqlite3` (native binding; the app ships the MCP binary so this is fine).
- `active account` = the row where `is_active = 1`. This is the default `accountId` for every tool.
- When the app switches active account, the MCP inherits the change on next read (no separate sync).

### Credentials — OS keyring, with local-file fallback
Per-account credentials live in the **system keyring**, service name **`emr-management-tool`**, keys **`{accountId}/access_key`**, **`{accountId}/secret_key`**, **`{accountId}/session_token`** (cf. `credentials.rs:13,130`).

- Primary: `keyring` npm package, same service name, same key scheme — reads the exact entries the app wrote.
- Fallback: if keyring access fails (e.g. macOS keychain ACL not granted to the node process), read the local store file `app_data_dir()/emr-management-tool.credentials.json` (the app's `use_local_credential_store` / debug path). Document this fallback in the error message so the user knows to approve keychain access.
- On every tool call, build the AWS `SdkConfig` per account the same way `aws_config_from_account` does (region + static credentials provider), so per-request clients naturally pick up any session-token expiry behaviour from the AWS SDK.

### Credential isolation enforcement

- **Never echo secrets**: tool outputs only return job/log data; credential material stays in the `@aws-sdk` client and is never serialized.
- **`list_accounts` returns only `name` + `region`**: no credential material of any kind (not even masked key ID). The agent only needs to identify the right account by name; the server handles all credential resolution.
- **No tool argument accepts credentials**: there is no "override credentials" parameter on any tool.
- **Errors never leak credentials**: AWS SDK errors are mapped through the same `AppError` pattern (service + code + message, no credential content).
- **Credential strings are dropped after client construction**: the keyring/file reader creates the `@aws-sdk` static credentials provider, then the raw strings are garbage-collected.

### Read-only IAM

Never echo secrets: tool outputs only ever return job/log data; credential material stays in the store.

Truncation: `get_simplified_logs` and `analyze_job_failure` cap output (default 512k chars) so a job's full log can't blow the agent context.

## Log sanitization

Before any log text or failure analysis content is returned to the MCP caller, the output passes through a **sanitizer** that redacts patterns that could identify internal infrastructure or leak sensitive context to the LLM.

### What gets redacted

| Pattern | Redaction | Example |
|---|---|---|
| AWS account ID (12 digits) | `[AWS_ACCOUNT_ID]` | `123456789012` → `[AWS_ACCOUNT_ID]` |
| S3 bucket name (in `s3://` URIs) | `[S3_BUCKET]` | `s3://my-data-lake-us-east-1/` → `s3://[S3_BUCKET]/` |
| Execution role ARN | `[ROLE_ARN]` | `arn:aws:iam::123456789012:role/EMR_ExecutionRole` → `[ROLE_ARN]` |
| Any `arn:aws:*` ARN | `[ARN]` | `arn:aws:logs:us-east-1:123456789012:log-group:/aws/emr/*` → `[ARN]` |
| IPv4 addresses | `[IP_ADDRESS]` | `10.0.1.45` → `[IP_ADDRESS]` |
| Hostnames / FQDNs | `[HOSTNAME]` | `ip-10-0-1-45.ec2.internal` → `[HOSTNAME]` |

### How it works

The sanitizer is a simple regex-based pipeline (no NLP, no LLM) applied to the **text output** of `get_simplified_logs` and `analyze_job_failure`:

1. Run each regex in order over the full text.
2. Matching segments are replaced with a fixed placeholder token.
3. The sanitizer is **applied server-side, after the noise filter, before the result is returned to the MCP caller**.

### Design notes

- **Conservative by default**: the regexes are intentionally broad — better to over-redact a harmless string than to let a real sensitive value through. The developer can see the original text in the local audit trail.
- **No impact on credential isolation**: the sanitizer operates on the **log content** (job logs, error messages), not on the credential store. Credentials are already isolated per the [Credential isolation principle](#credential-isolation-principle).
- **The `text` field in the audit trail is the sanitized version by default**, with an option to view the raw text (see [Audit trail for developers](#audit-trail-for-developers) below).

## Audit trail for developers

Every MCP tool invocation is recorded locally in a structured JSON log file. This serves as the **developer's record of what the LLM actually saw** — useful for debugging misbehaving agents, verifying sanitization, and reviewing the interaction history.

### Storage

- **Location**: `app_data_dir()/mcp-audit/` (same directory convention as the app's own log file).
- **Format**: one JSONL file per day, `mcp-audit-YYYY-MM-DD.jsonl`, each line a JSON object.
- **Rotation**: kept for 30 days, then auto-cleaned. The MCP server prunes on startup.

### Log entry shape

Each line records:

```json
{
  "timestamp": "2026-08-18T10:30:00.123Z",
  "tool": "analyze_job_failure",
  "args": {
    "jobId": "abcdef123",
    "virtualClusterId": "vc-xyz",
    "accountId": "acct-1"
  },
  "resultPreview": {
    "sizeChars": 45230,
    "candidateCauses": ["OOM", "stage failure"],
    "sanitized": true
  },
  "duration": 3420,
  "error": null
}
```

Key design decisions:
- **`args` records the full arguments** (jobId, clusterId, etc.) — this is the developer-side record of *what was asked*.
- **`resultPreview` is metadata only** — it records the result size, cause list, and whether sanitization applied, but does **not** store the full result text in the audit log by default. This keeps the audit log small and avoids storing gigabytes of log text.
- **`duration` in milliseconds** helps spot slow tools.
- **`error`** captures AWS SDK errors that were returned to the caller.

### Viewing the full interaction

Two ways to access the raw interaction for a specific invocation:

1. **MCP tool `get_audit_entry`** (added as a developer-only tool):
   - Args: `entryId` (the auto-generated UUID of the audit entry)
   - Returns: the full JSON entry with an optional `includeRawText: boolean` flag — if true, the **unsanitized** log text is included (only when the caller is on localhost, no auth boundary to cross).
   - This lets a developer inspect exactly what was sent to the LLM, and what was redacted by the sanitizer.

2. **File-based**: the raw response text (sanitized) is written to `app_data_dir()/mcp-audit/raw/<entryId>.txt` for direct file system inspection. The `raw/` directory is excluded from the 30-day rotation (manual cleanup).

### Desktop app integration

The existing Tauri app's **Help → View Logs** menu item (which opens the app's own log file directory) is extended to also open the MCP audit directory, so developers can browse both logs from the same place.

### What this enables

- **Debugging agent behavior**: "Why did the LLM say the job failed due to OOM?" — look up the audit entry, see exactly what log text was returned.
- **Verifying sanitization**: check the unsanitized raw text against the sanitized version, confirm the redaction is correct.
- **Performance monitoring**: spot slow `describe_job` or log-fetch calls.
- **Reproducing issues**: the `args` in the audit entry can be replayed against the MCP server to reproduce a problem.

## Transport & config

MCP listens on **`localhost:<port>`** over HTTP, serving **both SSE and Streamable HTTP** transports on the same port (dispatch by path, e.g. `/mcp` for Streamable HTTP, `/sse` for SSE). Claude Code / Cursor connect with a `url` rather than a `command`.

### Port
- Configurable, **default `5175`**.
- On startup, **check the configured port; if occupied, increment (+1) until a free port is found**.
- Log the resolved port and expose the final URL (`http://localhost:<resolvedPort>/mcp`).
- The desktop app reads back the resolved URL (so it can log it / offer "copy MCP URL" / auto-write a caller's MCP config). Do **not** silently change a URL the caller has pinned — if the resolved port differs from the configured one, surface it loudly.

### Why localhost only
The tools read AWS logs. Binding to `0.0.0.0` would let any device on the local network invoke tools and read those logs. v1 binds **localhost only**. No 0.0.0.0, no transport-layer auth.

### Example caller config (Claude Code `.mcp.json`)
```json
{
  "mcpServers": {
    "emr-job-logs": {
      "url": "http://localhost:5175/mcp"
    }
  }
}
```
(Use Streamable HTTP `url`; SSE is the alternative at `http://localhost:5175/sse`.)

## Why Node over Rust (rationale)

- The **noise filter, semantic parser, tree builder, destination resolver, and log display are already TypeScript** and thoroughly tested. A Node MCP server imports them unchanged → **zero drift** between GUI and agent behavior.
- The only Rust pieces worth porting are thin: `runtime_for_context` (→ AWS SDK env/credential config + the keyring/file reader), `get_job_logs` (~60 lines of CloudWatch calls), and the S3 `GetObject` read. All small and stable.
- `@modelcontextprotocol/sdk` + `@aws-sdk/*` + `better-sqlite3` + `keyring` is the lowest-friction path for a read-only MCP that shares the app's store.

## Deliverables

1. `mcp/` package: `package.json`, `tsconfig.json`, `src/index.ts` (MCP server with SSE + Streamable HTTP, port auto-bump), `src/tools/*.ts` (one file per tool), `src/aws/*.ts` (port of runtime.rs + logs.rs + s3.rs), `src/store/*.ts` (SQLite account reader + keyring credential reader), `src/analysis/*.ts` (failure extractor + cause matcher), `src/sanitize/*.ts` (log content sanitizer), `src/audit/*.ts` (structured audit trail writer + reader).
2. Reuse `src/services/{logNoiseFilter,logSemanticHighlight,emrLogTree,jobLogDestinations,logDisplay,logSearch}.ts` via a shared/importable path (they are side-effect-free pure functions).
3. Unit tests mirroring the existing suite: noise-filter passthrough, destination resolution (S3-preferred), failure-cause matcher, account/credential reader, **sanitizer** (redaction patterns), **audit trail** (write/read/rotate), tool argument validation (incl. required `virtualClusterId`).
4. `.mcp.json` example in repo root + README section on connecting Claude Code / Cursor.
5. Desktop-app integration: a launch/toggle entry that starts the MCP subprocess, reads its resolved URL, and exposes it (log + copy + auto-register); extend Help → View Logs to also open the MCP audit directory.
