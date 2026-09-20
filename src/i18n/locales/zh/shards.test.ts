import { describe, expect, it } from "vitest";
import { shards, zh } from "@/i18n/locales/zh";

/**
 * Feature shards are authored area by area and independently translated, and they
 * share vocabulary (`Cancel`, `Template`, `Refresh`, …). The merge is a spread, so
 * a key defined twice silently resolves to whichever shard comes last. These
 * guards make that visible instead.
 */
describe("zh shard merge", () => {
  it("does not define one key with two different translations", () => {
    const seen = new Map<string, { shard: string; value: string }>();
    const conflicts: string[] = [];

    for (const [shard, entries] of Object.entries(shards)) {
      for (const [key, value] of Object.entries(entries)) {
        const previous = seen.get(key);
        if (previous && previous.value !== value) {
          conflicts.push(
            `"${key}": ${previous.shard}="${previous.value}" vs ${shard}="${value}"`
          );
        }
        seen.set(key, { shard, value });
      }
    }

    expect(conflicts).toEqual([]);
  });

  it("merges every shard entry into the flat dictionary", () => {
    const fromShards = new Set(Object.values(shards).flatMap((entries) => Object.keys(entries)));
    expect(new Set(Object.keys(zh))).toEqual(fromShards);
  });

  it("never resolves a key to an empty string", () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(value.trim(), `empty entry for "${key}"`).not.toBe("");
    }
  });
});
