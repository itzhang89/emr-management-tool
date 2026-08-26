/**
 * Client identification for the audit trail.
 *
 * The stateless Streamable HTTP transport builds a fresh MCP server per
 * request, so an `initialize` handshake seen on one request tells us nothing
 * about the next one. Identify the caller from the request itself instead:
 * MCP clients send a `user-agent` (Claude Code sends e.g. "claude-cli/2.0.22")
 * and the SDK exposes the originating HTTP request as `extra.requestInfo`.
 */

export interface ClientInfo {
  name: string;
  version?: string;
}

type HandlerExtra = {
  requestInfo?: { headers?: Record<string, string | string[] | undefined> };
};

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  // Node lowercases incoming header names, but match case-insensitively so a
  // transport that preserves the original casing still resolves.
  const wanted = name.toLowerCase();
  const raw =
    headers[name] ??
    headers[wanted] ??
    Object.entries(headers).find(([key]) => key.toLowerCase() === wanted)?.[1];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}

/**
 * Resolve a human-readable client label for one tool call.
 *
 * Precedence: an explicit `x-mcp-client` header, then the request's
 * `user-agent`, then the `clientInfo` from the most recent initialize on this
 * process, and finally "unknown".
 */
export function resolveClientName(extra: unknown, fallback?: ClientInfo): string {
  const headers = (extra as HandlerExtra | undefined)?.requestInfo?.headers;
  const fromHeader =
    headerValue(headers, "x-mcp-client") ?? headerValue(headers, "user-agent");
  if (fromHeader) return fromHeader;
  if (fallback) {
    return fallback.version ? `${fallback.name}/${fallback.version}` : fallback.name;
  }
  return "unknown";
}
