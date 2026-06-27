import { describe, expect, it } from "vitest";
import {
  getShortcutPrimaryKey,
  groupKeyboardShortcutsByCategory,
  keyboardShortcuts,
  SHORTCUT_IDS,
  shortcutCategories
} from "./keyboardShortcuts";

describe("keyboardShortcuts registry", () => {
  it("defines unique shortcut ids", () => {
    const ids = keyboardShortcuts.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("groups shortcuts by known categories", () => {
    const groups = groupKeyboardShortcutsByCategory();
    expect(groups.length).toBeGreaterThanOrEqual(shortcutCategories.length);
    expect(groups.flatMap((group) => group.shortcuts)).toHaveLength(keyboardShortcuts.length);
  });

  it("exposes glue run shortcut labels", () => {
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.GLUE_RUN_QUERY)).toMatch(/Enter/);
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.OPEN_SHORTCUTS_HELP)).toBeTruthy();
  });

  it("exposes submit job shortcut labels", () => {
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.SUBMIT_JOB)).toMatch(/Enter/);
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.SUBMIT_PREVIEW_JSON)).toMatch(/P/i);
  });

  it("exposes account and navigation shortcut labels", () => {
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.ACCOUNT_SWITCH)).toMatch(/E/i);
    expect(getShortcutPrimaryKey("nav-history")).toMatch(/2/);
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.NAV_PREV_PAGE)).toMatch(/\[/);
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.NAV_NEXT_PAGE)).toMatch(/]/);
  });
});
