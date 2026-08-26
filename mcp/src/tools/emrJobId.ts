/**
 * EMR on EKS job run id validation.
 *
 * Mirrors the desktop app's `src/services/emrJobId.ts`. The MCP tool refuses
 * anything that is not a plausible EMR job id rather than spending a
 * cross-account search on it — a truncated or hallucinated id must come back to
 * the caller as a correction request, not as "job not found".
 */

/** "spark-<id>" and a bare "<id>" address the same job. */
export function normalizeEmrJobRunId(value: string): string {
  return value.trim().replace(/^spark-/i, "").trim();
}

/**
 * EMR on EKS ids are opaque lowercase alphanumeric strings (19 chars in
 * practice); `job-…` is accepted for the classic EMR form. The width bound is
 * what rejects a truncated id, which is the common failure mode when a model
 * copies the id out of a prompt.
 */
export function isLikelyEmrJobRunId(value: string): boolean {
  const normalized = normalizeEmrJobRunId(value);
  return /^job-[A-Za-z0-9-]+$/.test(normalized) || /^[a-z0-9]{16,64}$/.test(normalized);
}

/** Human-readable reason an id was rejected, for the tool's error payload. */
export function describeInvalidJobId(value: string): string {
  const normalized = normalizeEmrJobRunId(value);
  if (normalized.length === 0) {
    return "The job id is empty.";
  }
  if (/\s/.test(normalized)) {
    return "The job id contains whitespace — pass a single job id with no surrounding text.";
  }
  if (/^[a-z0-9]+$/.test(normalized) && normalized.length < 16) {
    return `The job id "${normalized}" is only ${normalized.length} characters; EMR on EKS job ids are at least 16. It looks truncated — supply the complete id.`;
  }
  if (/[A-Z]/.test(normalized) && !normalized.startsWith("job-")) {
    return `The job id "${normalized}" contains uppercase characters; EMR on EKS job ids are lowercase alphanumeric.`;
  }
  return `"${normalized}" is not a valid EMR job run id. Expected a lowercase alphanumeric id of 16-64 characters (optionally prefixed with "spark-"), or a "job-…" id.`;
}
