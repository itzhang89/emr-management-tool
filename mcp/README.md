# EMR Job Log MCP Server

Model Context Protocol (MCP) server for analyzing EMR on EKS job logs. Connect from Claude Code or any MCP-compatible agent to inspect job failures, fetch sanitized logs, and get error root-cause analysis.

## Features

- **`list_accounts`** — list configured AWS accounts (username only, no credentials)
- **`describe_job`** — get job status, state, monitoring config
- **`list_job_logs`** — list log files for a job (driver / executor / controller)
- **`get_simplified_logs`** — fetch logs, apply noise filter, sanitize sensitive data, and return a clean summary
- **`analyze_job_failure`** — run heuristic error analysis: extract deepest `Caused by`, match 15+ known failure patterns, rank candidate causes
- **`search_logs`** — search CloudWatch logs with filter patterns
- **`get_audit_entry`** — developer tool to inspect past MCP tool interactions (localhost only)

## Quick Start

```bash
cd mcp
npm install
npm run build
npm start
# Server starts on localhost:5175 (auto-bumps if port is in use)
```

## Configure Claude Code

Copy `.mcp.json.example` to your Claude Code config and adjust the port:

```bash
cp mcp/.mcp.json.example ~/.claude/mcp.json
```

## Credential Isolation

This server **never** exposes AWS credentials to any external party:

- Credentials are loaded via `@aws-sdk/credential-provider-node` (`defaultProvider`)
- Credentials exist only in memory within the AWS SDK client, never serialized
- `list_accounts` returns only `{ id, name, region, isActive }`
- Log sanitizer redacts ARNs, account IDs, IPs, hostnames, and S3 bucket names before logs are returned to any caller

## Log Sanitization

All logs returned by MCP tools are sanitized server-side via regex rules:

| Pattern | Replacement |
|---|---|
| 12-digit AWS account IDs | `[AWS_ACCOUNT_ID]` |
| ARNs | `[ARN]` |
| S3 bucket names | `[S3_BUCKET]` |
| IPv4 addresses | `[IP_ADDRESS]` |
| EC2 hostnames | `[HOSTNAME]` |
| FQDNs | `[HOSTNAME]` |

## Audit Trail

Every MCP tool invocation is logged to JSONL files at:

```
~/Library/Application Support/emr-management-tool/mcp-audit/mcp-audit-YYYY-MM-DD.jsonl
```

- 30-day retention with automatic rotation
- Raw log text saved alongside each entry
- Accessible via `get_audit_entry` tool (localhost only)

## Project Structure

```
mcp/
├── src/
│   ├── aws/          # AWS SDK clients (EMR, CloudWatch, S3, STS)
│   ├── analysis/     # Heuristic failure cause extraction
│   ├── audit/        # JSONL audit trail
│   ├── sanitize/     # Log redaction pipeline
│   ├── store/        # Account store (sql.js SQLite)
│   ├── tools/        # MCP tool handlers
│   ├── types/        # sql.js TypeScript declarations
│   └── index.ts      # MCP server bootstrap
├── __tests__/        # Vitest test suite
├── .mcp.json.example
├── package.json
└── tsconfig.json
```

## Development

```bash
npm run dev        # tsx-based dev server
npm test           # run tests
npm run test:watch # watch mode
npm run build      # TypeScript compilation
```

## Port

Default port: `5175`. The server auto-bumps to the next free port if occupied.