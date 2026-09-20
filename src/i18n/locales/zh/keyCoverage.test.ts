import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { zh } from "@/i18n/locales/zh";

/**
 * A literal key that has no entry renders as its English source — correct as a
 * fallback, but invisible as a defect: nothing in the UI says "untranslated".
 * This scans the source for literal `t("…")` calls and fails on any key that is
 * missing from the dictionary.
 *
 * Dynamic calls (`t(someVariable)`) cannot be checked statically and are skipped.
 *
 * If a string ever genuinely should stay English, leave it *unwrapped* rather
 * than adding it here — wrapping it in `t()` claims it is translatable.
 */

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\./.test(full)) out.push(full);
  }
  return out;
}

function literalKeys() {
  const found = new Map<string, string>();
  const call = /\bt\(\s*"((?:[^"\\]|\\.)*)"/g;

  for (const file of sourceFiles("src")) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(call)) {
      // Unescape so a key containing \" matches the dictionary spelling.
      const key = JSON.parse(`"${match[1]}"`) as string;
      if (!found.has(key)) found.set(key, file);
    }
  }
  return found;
}

describe("zh key coverage", () => {
  it("translates every literal t() key used in the source", () => {
    const missing = [...literalKeys().entries()]
      .filter(([key]) => zh[key] === undefined)
      .map(([key, file]) => `${JSON.stringify(key)} (first used in ${file})`);

    expect(missing).toEqual([]);
  });

  it("finds the keys it is meant to check", () => {
    // Guards against the scanner silently matching nothing after a refactor.
    expect(literalKeys().size).toBeGreaterThan(500);
  });
});
