import { describe, expect, it, vi } from "vitest";
import { formatShortcutsHelpLabel, isShortcutsHelpKey } from "./keyboardShortcut";

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
