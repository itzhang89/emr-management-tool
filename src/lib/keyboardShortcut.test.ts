import { describe, expect, it, vi } from "vitest";
import { formatShortcutsHelpLabel, isShortcutsHelpKey, isSidebarToggleKey } from "./keyboardShortcut";

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
