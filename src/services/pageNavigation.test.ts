import { describe, expect, it } from "vitest";
import { getAdjacentPageId, getNavigationIndex, getPageIdByNavigationIndex } from "./pageNavigation";

describe("pageNavigation", () => {
  it("maps sidebar order to page ids", () => {
    expect(getPageIdByNavigationIndex(1)).toBe("submit");
    expect(getPageIdByNavigationIndex(2)).toBe("history");
    // Logs is no longer a page of its own, so S3 follows Job History.
    expect(getPageIdByNavigationIndex(3)).toBe("s3");
    expect(getPageIdByNavigationIndex(4)).toBe("glue");
    expect(getPageIdByNavigationIndex(5)).toBe("ai");
    expect(getPageIdByNavigationIndex(6)).toBe("secrets");
    expect(getPageIdByNavigationIndex(7)).toBe("dashboard");
    expect(getPageIdByNavigationIndex(8)).toBe("templates");
    expect(getPageIdByNavigationIndex(9)).toBe("clusters");
    // Settings is last even though the sidebar pins it below the nav list: the
    // number shortcuts follow the source order, top to bottom.
    expect(getPageIdByNavigationIndex(10)).toBe("settings");
    expect(getPageIdByNavigationIndex(11)).toBeUndefined();
  });

  it("maps page ids back to sidebar indexes", () => {
    expect(getNavigationIndex("submit")).toBe(1);
    expect(getNavigationIndex("glue")).toBe(4);
    expect(getNavigationIndex("ai")).toBe(5);
    expect(getNavigationIndex("settings")).toBe(10);
  });

  it("cycles pages in sidebar order", () => {
    expect(getAdjacentPageId("submit", -1)).toBe("settings");
    expect(getAdjacentPageId("settings", 1)).toBe("submit");
    expect(getAdjacentPageId("history", 1)).toBe("s3");
    expect(getAdjacentPageId("s3", -1)).toBe("history");
  });
});
