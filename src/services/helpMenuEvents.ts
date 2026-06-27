import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "@/lib/tauriRuntime";

export const HELP_SHOW_SHORTCUTS_EVENT = "help:show-shortcuts";
export const HELP_SHOW_ABOUT_EVENT = "help:show-about";

export async function bindHelpMenuEvents(handlers: {
  onShowShortcuts: () => void;
  onShowAbout: () => void;
}) {
  if (!isTauriRuntime()) {
    return () => {};
  }

  const unlistenShortcuts = await listen(HELP_SHOW_SHORTCUTS_EVENT, () => handlers.onShowShortcuts());
  const unlistenAbout = await listen(HELP_SHOW_ABOUT_EVENT, () => handlers.onShowAbout());

  return () => {
    unlistenShortcuts();
    unlistenAbout();
  };
}
