/**
 * Log content sanitizer — redacts sensitive patterns before returning to the LLM.
 *
 * Applied server-side as a final step in get_simplified_logs and analyze_job_failure.
 * Conservative by design: better to over-redact than to miss a sensitive value.
 */

interface SanitizeRule {
  pattern: RegExp;
  replacement: string;
}

/** Order matters: broader patterns first, then more specific. */
const RULES: SanitizeRule[] = [
  // AWS ARNs (any service) — must come before account ID patterns
  { pattern: /\barn:aws:[a-z0-9-]+:[a-z0-9-]*:\d{12}:[^\s"'`)\]>,;]+/g, replacement: "[ARN]" },

  // S3 URIs — redact bucket name only, keep scheme
  // Matches: s3://bucket-name/key/path, s3://bucket-name
  { pattern: /s3:\/\/([a-z0-9][a-z0-9.-]*[a-z0-9])(?:\/|$)/gi, replacement: "s3://[S3_BUCKET]/" },

  // Standalone AWS account IDs (12 digits) — not already in an ARN
  { pattern: /(?<!\d)(\d{12})(?!\d)/g, replacement: "[AWS_ACCOUNT_ID]" },

  // IPv4 addresses
  { pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: "[IP_ADDRESS]" },

  // EC2 internal hostnames: ip-10-0-1-45.ec2.internal, ip-10-0-1-45.ec2.internal
  { pattern: /\bip-\d{1,3}(?:-\d{1,3}){3}\.ec2\.internal\b/g, replacement: "[HOSTNAME]" },

  // Generic FQDNs (at least 2 dots, no protocol prefix)
  // e.g. node-1.example.com, my-cluster.us-east-1.elb.amazonaws.com
  { pattern: /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){2,}\b/g, replacement: "[HOSTNAME]" },
];

export function sanitizeLogText(text: string): string {
  if (!text) return text;
  let result = text;
  for (const rule of RULES) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result;
}

/** Returns the list of rules for testing/debugging */
export function getSanitizeRules(): SanitizeRule[] {
  return RULES;
}