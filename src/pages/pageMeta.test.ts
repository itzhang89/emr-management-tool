import { describe, expect, it } from "vitest";
import { getPageMeta, navigationItems } from "./pageMeta";

describe("getPageMeta", () => {
  it("returns navigation metadata for each page id", () => {
    for (const item of navigationItems) {
      expect(getPageMeta(item.id)).toEqual(item);
    }
  });

  it("throws for unknown page ids", () => {
    expect(() => getPageMeta("unknown" as never)).toThrow(/Unknown page id/);
  });
});
