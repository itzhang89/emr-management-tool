import type { RedactRule } from "@/types/domain";

/**
 * Replacement logic shared by the Redaction tab's inline previews.
 *
 * This mirrors the backend engine (`mcp/sanitize`) and the original
 * "Shield · Rules" web UI so that a row or form preview matches what the
 * in-process MCP tools actually do once saved. It is pure — no IPC — so the
 * live preview can recompute as the user types.
 *
 * A custom rule masks every whole token its regex matches with one of:
 *   __MASK_ALL__                 equal-length stars
 *   __KEEP_HEAD_TAIL_<a>_<b>__   keep the first a + last b chars, star the rest
 *   (anything else)              a fixed literal replacement
 */

/** Map a whole matched token to its masked form under `replacement`. */
export function applyReplacement(token: string, replacement: string): string {
  const repl = replacement && replacement.trim() !== "" ? replacement : "";
  if (repl === "__MASK_ALL__") {
    return token.length ? "*".repeat(token.length) : "***";
  }
  const keep = /^__KEEP_HEAD_TAIL_(\d+)_(\d+)__$/.exec(repl);
  if (keep) {
    return keepHeadTailMask(token, Number(keep[1]), Number(keep[2]));
  }
  return repl || "***";
}

/** Keep first `a` and last `b` characters of `token`, stars in between; mask
 * everything when the token is too short for anything to remain. */
export function keepHeadTailMask(token: string, a: number, b: number): string {
  const len = token.length;
  if (len <= a + b) return "*".repeat(len);
  return token.slice(0, a) + "*".repeat(len - a - b) + token.slice(len - b);
}

/** Validate a regex source; masks `g` for pass-matching, throws on bad source. */
export function compilePattern(pattern: string): RegExp | null {
  if (!pattern) return null;
  try {
    return new RegExp(pattern);
  } catch {
    return null;
  }
}

/** The default sample text per category when a rule has no sample of its own. */
export const CATEGORY_SAMPLE: Record<string, string> = {
  secret: "SKIA-blahblah-blahblah-blahblah-blah",
  pii: "The agent said 13812345678 and zhang@example.com",
  network: "Connecting to 192.168.1.100 and host.example.internal:8080",
  custom: "referring to TICKET-123456 and TICKET-789012"
};

/** Pick the text a rule's preview row should operate on. */
export function previewSampleFor(rule: RedactRule): string {
  const sample = rule.sample?.trim();
  if (sample) return sample;
  return CATEGORY_SAMPLE[rule.category] ?? CATEGORY_SAMPLE.custom;
}

/**
 * Preview one rule on its sample: the rule's chosen sample text, the full
 * before (sample) and the after (sample with every match replaced), or null
 * when the pattern is unusable and nothing can be shown.
 */
export function previewRule(rule: RedactRule): { before: string; after: string } | null {
  const sample = previewSampleFor(rule);
  if (!rule.pattern) return null;
  let re: RegExp;
  try {
    re = new RegExp(rule.pattern);
  } catch {
    return null;
  }
  if (!re.test(sample)) return { before: sample, after: sample };
  // Reset lastIndex (compiled without /g it is stateless), walk each token.
  let after = "";
  let last = 0;
  for (const m of sample.matchAll(new RegExp(rule.pattern, "g"))) {
    const index = m.index ?? 0;
    after += sample.slice(last, index) + applyReplacement(m[0], rule.replacement ?? "");
    last = index + m[0].length;
  }
  after += sample.slice(last);
  return { before: sample, after };
}

/** A fresh, empty custom rule for the create form. */
export function blankCustomRule(): RedactRule {
  return {
    id: "",
    name: "",
    category: "custom",
    pattern: "",
    replacement: "__MASK_ALL__",
    sample: "",
    enabled: true,
    kind: "custom",
    sortOrder: 0
  };
}
