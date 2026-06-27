import { beforeEach, describe, expect, it, vi } from "vitest";
import { bindHelpMenuEvents, HELP_SHOW_ABOUT_EVENT, HELP_SHOW_SHORTCUTS_EVENT } from "./helpMenuEvents";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(async () => vi.fn())
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen
}));

vi.mock("@/lib/tauriRuntime", () => ({
  isTauriRuntime: () => true
}));

describe("bindHelpMenuEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers help menu event listeners in tauri", async () => {
    const onShowShortcuts = vi.fn();
    const onShowAbout = vi.fn();

    await bindHelpMenuEvents({ onShowShortcuts, onShowAbout });

    expect(mocks.listen).toHaveBeenCalledWith(HELP_SHOW_SHORTCUTS_EVENT, expect.any(Function));
    expect(mocks.listen).toHaveBeenCalledWith(HELP_SHOW_ABOUT_EVENT, expect.any(Function));
  });
});
