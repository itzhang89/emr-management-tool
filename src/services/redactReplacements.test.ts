import { describe, expect, it } from "vitest";
import {
  applyReplacement,
  blankCustomRule,
  keepHeadTailMask,
  previewRule
} from "./redactReplacements";
import type { RedactRule } from "@/types/domain";

function custom(over: Partial<RedactRule>): RedactRule {
  return {
    ...blankCustomRule(),
    id: "c1",
    name: "Ticket",
    category: "custom",
    kind: "custom",
    ...over
  };
}

describe("applyReplacement", () => {
  it("masks __MASK_ALL__ to equal-length stars", () => {
    expect(applyReplacement("TICKET-123456", "__MASK_ALL__")).toBe("*************");
  });

  it("keeps head and tail around stars", () => {
    expect(keepHeadTailMask("1234567812345678", 4, 4)).toBe("1234********5678");
    // Too short to keep anything -> mask everything.
    expect(applyReplacement("1234", "__KEEP_HEAD_TAIL_3_3__")).toBe("****");
  });

  it("uses a fixed literal", () => {
    expect(applyReplacement("sk-foo123456", "[TOKEN]")).toBe("[TOKEN]");
  });

  it("falls back to *** when replacement is empty", () => {
    expect(applyReplacement("abc", "")).toBe("***");
  });
});

describe("previewRule", () => {
  it("shows before/after of every match when pattern is usable", () => {
    const rule = custom({ category: "pii", pattern: "\\d{11}", replacement: "__MASK_ALL__" });
    const preview = previewRule(rule);
    expect(preview).not.toBeNull();
    // The pii category sample (CATEGORY_SAMPLE.pii) contains an 11-digit
    // phone; masking keeps the neighbours but hides the digits themselves.
    expect(preview!.after).not.toContain("13812345678");
    expect(preview!.after).toMatch(/\*{11}/);
  });

  it("returns null for an un-compilable pattern", () => {
    const rule = custom({ pattern: "[unterminated" });
    expect(previewRule(rule)).toBeNull();
  });

  it("uses the rule's own sample when given", () => {
    const rule = custom({ pattern: "SECRET-\\d+", sample: "stored SECRET-9 and SECRET-42" });
    const preview = previewRule(rule);
    expect(preview!.before).toBe("stored SECRET-9 and SECRET-42");
    // SECRET-9 → 8 stars, SECRET-42 → 9 stars.
    expect(preview!.after).toBe("stored ******** and *********");
  });
});
