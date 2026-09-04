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
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.SUBMIT_TOGGLE_MODE)).toBe("Tab");
  });

  it("exposes account and navigation shortcut labels", () => {
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.ACCOUNT_SWITCH)).toMatch(/E/i);
    expect(getShortcutPrimaryKey("nav-history")).toMatch(/2/);
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.NAV_PREV_PAGE)).toMatch(/\[/);
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.NAV_NEXT_PAGE)).toMatch(/]/);
  });

  it("exposes history and logs focus-search shortcuts", () => {
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.HISTORY_FOCUS_SEARCH)).toMatch(/F/i);
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.LOGS_FOCUS_JOB_ID)).toMatch(/F/i);
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.LOGS_FIND)).toMatch(/F/i);
  });

  it("exposes the chat clear-context shortcut under the ai category", () => {
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.CHAT_CLEAR_CONTEXT)).toMatch(/K/i);

    const clearContext = keyboardShortcuts.find((s) => s.id === SHORTCUT_IDS.CHAT_CLEAR_CONTEXT);
    expect(clearContext?.category).toBe("ai");
    expect(clearContext?.description.toLowerCase()).toMatch(/history visible/);
  });

  it("exposes S3 editor find shortcuts", () => {
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.S3_FIND)).toMatch(/F/i);
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.S3_REPLACE)).toMatch(/R/i);
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.S3_FIND_NEXT)).toMatch(/G/i);
    expect(getShortcutPrimaryKey(SHORTCUT_IDS.S3_FIND_PREVIOUS)).toMatch(/G/i);

    const find = keyboardShortcuts.find((s) => s.id === SHORTCUT_IDS.S3_FIND);
    expect(find?.category).toBe("s3");
    expect(find?.description.toLowerCase()).toMatch(/close/);

    const replace = keyboardShortcuts.find((s) => s.id === SHORTCUT_IDS.S3_REPLACE);
    expect(replace?.category).toBe("s3");
    expect(replace?.description.toLowerCase()).toMatch(/exclude/);
  });
});
