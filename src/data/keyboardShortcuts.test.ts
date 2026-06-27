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
    expect(groups).toHaveLength(shortcutCategories.length);
    expect(groups.flatMap((group) => group.shortcuts)).toHaveLength(keyboardShortcuts.length);
  });

  it("exposes glue run shortcut labels", () => {
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.GLUE_RUN_QUERY)).toMatch(/Enter/);
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.OPEN_SHORTCUTS_HELP)).toBeTruthy();
  });
});
