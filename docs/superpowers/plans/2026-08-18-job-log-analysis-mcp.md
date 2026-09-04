# Job Log Analysis MCP Server — Plan

Implements the (revised) design in `docs/superpowers/specs/2026-08-18-job-log-analysis-mcp-design.md`.

Key revised decisions baked into the phases: transport is **SSE + Streamable HTTP on localhost** (port auto-bump), credentials come from the **app's SQLite + OS keyring** (not `.secretsallowlist` / env), `virtualClusterId` is **required**, `accountId` **defaults to the app's active account**, logs use **S3 preferred over CloudWatch**, and `analyze_job_failure` is **heuristic-only evidence** (no LLM).

**⚠️ Hard constraint**: AWS credentials are **NEVER passed to any tool result** — they exist only inside the `@aws-sdk` client, are never serialized, and `list_accounts` returns only `name` + `region` (no credential material of any kind). See [Credential isolation principle](./2026-08-18-job-log-analysis-mcp-design.md#credential-isolation-principle) in the design doc.

**Log sanitization**: all log content returned to the caller is sanitized server-side (account IDs, S3 bucket names, ARNs, IPs redacted).
**Audit trail**: every tool invocation is recorded in a structured JSONL file at `app_data_dir()/mcp-audit/` for developer inspection.

## Phase 1 — Scaffold the MCP package

- Create `mcp/` package: `package.json`, `tsconfig.json`, `.gitignore`.
- Dependencies: `@modelcontextprotocol/sdk`, `@aws-sdk/client-emr-containers`, `@aws-sdk/client-cloudwatch-logs`, `@aws-sdk/client-s3`, `@aws-sdk/client-sts`, `better-sqlite3`, `keyring`, `zod` (input validation), `vitest` (dev).
- Entry `mcp/src/index.ts`: instantiate `McpServer`, register tools, run **SSE + Streamable HTTP** on `localhost:<port>`.
  - Port configurable (default `5175`); on bind failure **+1 until free**; log + expose the resolved URL.
- Tauri-side toggle: a launch/stop entry that spawns the MCP node subprocess and reads back its resolved URL.

## Phase 2 — App store reader + AWS client layer

- `mcp/src/store/accounts.ts` — read `app_data_dir()/emr-management-tool.sqlite` table `aws_accounts`; expose `listAccounts()`, `getActiveAccount()` (`is_active = 1`), `getAccount(id)`. Uses `better-sqlite3`.
- `mcp/src/store/credentials.ts` — per-account credentials: primary **OS keyring** (service `emr-management-tool`, keys `{accountId}/access_key|secret_key|session_token`) via `keyring`; **fallback** to `app_data_dir()/emr-management-tool.credentials.json` on keyring failure. Emits a clear error telling the user to approve keychain access.
- `mcp/src/aws/runtime.ts` — per-account `SdkConfig` factory mirroring `aws_config_from_account` (region + static credentials provider). Port of `runtime_for_context` without the Tauri `AppHandle`/DB.
- `mcp/src/aws/logs.ts` — port of `logs.rs` `list_job_log_streams` + `get_job_logs`: default log group `/aws/emr-containers/jobs/{id}`, JSON-normalized entries `{timestamp,level,message}`, level inference.
- `mcp/src/aws/s3.ts` — port of the S3 log read: `GetObject` + pagination over the job log prefix, JSON-normalize each object into the same `{timestamp,level,message}` shape.
- `mcp/src/aws/emr.ts` — port of `DescribeJobRun`.

## Phase 3 — Wire in the existing TS services

- Make `src/services/{logNoiseFilter,logSemanticHighlight,emrLogTree,jobLogDestinations,logDisplay,logSearch}.ts` importable by `mcp/` (shared tsconfig path or a small `mcp/src/reuse/` re-export). Confirm they are pure/no-side-effect so reuse is safe.

## Phase 4 — Log sanitizer

- `mcp/src/sanitize/index.ts` — regex-based sanitizer pipeline applied to log text before returning to the caller:
  - AWS account ID (12 digits) → `[AWS_ACCOUNT_ID]`
  - S3 bucket name in `s3://` URIs → `[S3_BUCKET]`
  - Any `arn:aws:*` → `[ARN]` (with special handling for execution role ARNs)
  - IPv4 addresses → `[IP_ADDRESS]`
  - Hostnames / FQDNs → `[HOSTNAME]`
- Applied as a final step in `get_simplified_logs` and `analyze_job_failure` tool handlers, after noise filter and before return.
- Unit tests for each pattern: confirm redaction, confirm no false positives on benign strings.

## Phase 5 — Audit trail

- `mcp/src/audit/index.ts` — structured audit log writer:
  - JSONL file per day at `app_data_dir()/mcp-audit/mcp-audit-YYYY-MM-DD.jsonl`.
  - Each entry: `{timestamp, tool, args, resultPreview: {sizeChars, candidateCauses, sanitized}, duration, error}`.
  - Raw response text (sanitized) saved to `app_data_dir()/mcp-audit/raw/<entryId>.txt`.
  - 30-day auto-rotation (prune on startup).
- `get_audit_entry` developer tool: `entryId` → full audit entry with optional `includeRawText` flag.
- Middleware in the tool handler: wraps every tool invocation to record the audit entry automatically.

## Phase 6 — Failure analysis extractor

- `mcp/src/analysis/extractError.ts` — traceback block + `Caused by:` extraction (return deepest), ETL `stepId` context.
- `mcp/src/analysis/causes.ts` — keyword → candidate-cause table (OOM / permission / missing class / bad SQL / stage failure / script exit / cancelled).
- Unit tests for both: traceback boundary detection, deepest-`Caused by` selection, cause-matcher cases.

## Phase 7 — Tools

- `list_accounts` — thin over `store/accounts.ts` → `{id,name,region,isActive}`. No credential material of any kind.
- `describe_job` — over `aws/emr.ts`; **`virtualClusterId` required**; `accountId` optional → active account.
- `list_job_logs` — over `aws/logs.ts` + `emrLogTree.buildEmrLogTree`.
- `get_simplified_logs` — destination resolve → fetch (**S3 first, then CloudWatch**, whichever exists) → `filterLogNoise` → **sanitize** (Phase 4) → truncate → `{text,hiddenCount,truncated,totalCharacters,entries,source}`.
- `analyze_job_failure` — `describe_job` + `get_simplified_logs` → semantic parse → error-section extractor (Phase 6) → cause matcher → report → **sanitize** (Phase 4). Evidence only, no LLM.
- `search_logs` — `aws/logs.ts` CloudWatch `filterPattern` + `logSearch.ts` client-side refinement.
- `get_audit_entry` — developer tool, localhost only, returns full audit entry (Phase 5) with optional raw text.

All tools wrapped with the audit trail middleware (Phase 5).

## Phase 8 — App integration + tests

- Desktop-app side: MCP launch/toggle entry; on start, read the resolved URL, log it, and expose it (console log + "copy MCP URL" + optional auto-write into a caller's MCP config). Graceful shutdown of the MCP subprocess on app quit; restart on app relaunch. Extend Help → View Logs to also open the MCP audit directory.
- Unit tests mirroring the existing suite: noise-filter passthrough, destination resolution (S3-preferred), failure-cause matcher, account/credential reader (keyring + file fallback), **sanitizer** (redaction patterns for each sensitive type), **audit trail** (write/read/rotate), tool argument validation (incl. required `virtualClusterId`).
- Manual smoke: start MCP, confirm resolved port/URL, invoke tools over SSE/HTTP against a known test job id.

## Acceptance

- MCP starts on `localhost`, resolves a free port (with +1 fallback), and exposes a stable URL.
- Claude Code / Cursor can connect via `url` (Streamable HTTP or SSE).
- `list_accounts` returns the app's configured accounts; defaulting works off the active account.
- `get_simplified_logs(jobId, virtualClusterId)` returns filtered log + hidden-count + `source` (s3|cloudwatch), using S3 when available.
- `analyze_job_failure(jobId, virtualClusterId)` returns state + evidence + candidate causes (no LLM).
- All operations are scoped to the resolved account and read-only.
