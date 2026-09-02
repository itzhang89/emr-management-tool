import { describe, expect, it, vi } from "vitest";
import {
  formatShortcutsHelpLabel,
  isAccountSwitchKey,
  isClearContextKey,
  isFocusSearchKey,
  isPageCycleNextKey,
  isPageCyclePreviousKey,
  isShortcutsHelpKey,
  isSidebarToggleKey,
  getPageNavigationIndex
} from "./keyboardShortcut";

describe("formatShortcutsHelpLabel", () => {
  it("returns platform-specific help shortcut label", () => {
    const platformSpy = vi.spyOn(navigator, "platform", "get");
    platformSpy.mockReturnValue("MacIntel");
    expect(formatShortcutsHelpLabel()).toBe("⌘+⇧+/");

    platformSpy.mockReturnValue("Win32");
    expect(formatShortcutsHelpLabel()).toBe("Ctrl+Shift+/");
    platformSpy.mockRestore();
  });
});

describe("isShortcutsHelpKey", () => {
  it("matches modifier plus question mark", () => {
    expect(
      isShortcutsHelpKey({
        key: "?",
        code: "Slash",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true
      })
    ).toBe(true);
  });

  it("matches modifier plus shift slash", () => {
    expect(
      isShortcutsHelpKey({
        key: "/",
        code: "Slash",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true
      })
    ).toBe(true);
  });

  it("ignores unmodified keys", () => {
    expect(
      isShortcutsHelpKey({
        key: "/",
        code: "Slash",
        metaKey: false,
        ctrlKey: false,
        shiftKey: true
      })
    ).toBe(false);
  });
});

describe("isSidebarToggleKey", () => {
  it("matches modifier plus slash without shift", () => {
    expect(
      isSidebarToggleKey({
        key: "/",
        code: "Slash",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false
      })
    ).toBe(true);
  });

  it("ignores shift slash used for shortcuts help", () => {
    expect(
      isSidebarToggleKey({
        key: "/",
        code: "Slash",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        altKey: false
      })
    ).toBe(false);
  });
});

describe("isAccountSwitchKey", () => {
  it("matches modifier plus E", () => {
    expect(
      isAccountSwitchKey({
        key: "e",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false
      })
    ).toBe(true);
  });
});

describe("getPageNavigationIndex", () => {
  it("matches modifier plus number keys", () => {
    expect(
      getPageNavigationIndex({
        key: "2",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false
      })
    ).toBe(2);
  });

  it("ignores unmodified number keys", () => {
    expect(
      getPageNavigationIndex({
        key: "2",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false
      })
    ).toBeNull();
  });
});

describe("page cycle keys", () => {
  it("matches modifier plus bracket keys", () => {
    expect(
      isPageCyclePreviousKey({
        key: "[",
        code: "BracketLeft",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false
      })
    ).toBe(true);
    expect(
      isPageCycleNextKey({
        key: "]",
        code: "BracketRight",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false
      })
    ).toBe(true);
  });
});

describe("isFocusSearchKey", () => {
  it("matches modifier plus F without shift", () => {
    expect(
      isFocusSearchKey({
        key: "f",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false
      })
    ).toBe(true);
  });

  it("rejects shift-modified F", () => {
    expect(
      isFocusSearchKey({
        key: "f",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        altKey: false
      })
    ).toBe(false);
  });
});

describe("isClearContextKey", () => {
  it("matches modifier plus K without shift", () => {
    expect(
      isClearContextKey({
        key: "k",
        metaKey: true,
        ctrlKey: false,
        shiftKey: false,
        altKey: false
      })
    ).toBe(true);
  });

  it("matches uppercase K and Ctrl as the primary modifier", () => {
    expect(
      isClearContextKey({
        key: "K",
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false
      })
    ).toBe(true);
  });

  it("rejects shift-modified and unmodified K", () => {
    expect(
      isClearContextKey({
        key: "k",
        metaKey: true,
        ctrlKey: false,
        shiftKey: true,
        altKey: false
      })
    ).toBe(false);
    expect(
      isClearContextKey({
        key: "k",
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false
      })
    ).toBe(false);
  });
});
