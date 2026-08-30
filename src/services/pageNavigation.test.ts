import { describe, expect, it } from "vitest";
import { getAdjacentPageId, getNavigationIndex, getPageIdByNavigationIndex } from "./pageNavigation";

describe("pageNavigation", () => {
  it("maps sidebar order to page ids", () => {
    expect(getPageIdByNavigationIndex(1)).toBe("submit");
    expect(getPageIdByNavigationIndex(2)).toBe("history");
    expect(getPageIdByNavigationIndex(7)).toBe("ai");
    expect(getPageIdByNavigationIndex(10)).toBe("settings");
    expect(getPageIdByNavigationIndex(11)).toBeUndefined();
  });

  it("maps page ids back to sidebar indexes", () => {
    expect(getNavigationIndex("submit")).toBe(1);
    expect(getNavigationIndex("glue")).toBe(5);
    expect(getNavigationIndex("ai")).toBe(7);
    expect(getNavigationIndex("settings")).toBe(10);
  });

  it("cycles pages in sidebar order", () => {
    expect(getAdjacentPageId("submit", -1)).toBe("settings");
    expect(getAdjacentPageId("settings", 1)).toBe("submit");
    expect(getAdjacentPageId("history", 1)).toBe("logs");
    expect(getAdjacentPageId("logs", -1)).toBe("history");
  });
});
