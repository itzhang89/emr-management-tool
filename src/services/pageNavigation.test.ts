import { describe, expect, it } from "vitest";
import { getAdjacentPageId, getNavigationIndex, getPageIdByNavigationIndex } from "./pageNavigation";

describe("pageNavigation", () => {
  it("maps sidebar order to page ids", () => {
    expect(getPageIdByNavigationIndex(1)).toBe("submit");
    expect(getPageIdByNavigationIndex(2)).toBe("history");
    expect(getPageIdByNavigationIndex(5)).toBe("glue");
    expect(getPageIdByNavigationIndex(6)).toBe("ai");
    expect(getPageIdByNavigationIndex(7)).toBe("secrets");
    expect(getPageIdByNavigationIndex(10)).toBe("clusters");
    // Settings is last even though the sidebar pins it below the nav list: the
    // number shortcuts follow the source order, top to bottom.
    expect(getPageIdByNavigationIndex(11)).toBe("settings");
    expect(getPageIdByNavigationIndex(12)).toBeUndefined();
  });

  it("maps page ids back to sidebar indexes", () => {
    expect(getNavigationIndex("submit")).toBe(1);
    expect(getNavigationIndex("glue")).toBe(5);
    expect(getNavigationIndex("ai")).toBe(6);
    expect(getNavigationIndex("settings")).toBe(11);
  });

  it("cycles pages in sidebar order", () => {
    expect(getAdjacentPageId("submit", -1)).toBe("settings");
    expect(getAdjacentPageId("settings", 1)).toBe("submit");
    expect(getAdjacentPageId("history", 1)).toBe("logs");
    expect(getAdjacentPageId("logs", -1)).toBe("history");
  });
});
