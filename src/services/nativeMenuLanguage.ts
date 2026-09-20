import { localeTag } from "@/i18n/locale";
import { getEffectiveLocale, subscribeToLanguage } from "@/i18n/store";
import { isTauriRuntime } from "@/lib/tauriRuntime";
import { tauriClient } from "@/services/tauriClient";

/**
 * Rust cannot read the language preference (it lives in `localStorage`), so the
 * resolved tag is pushed from here.
 */
export async function pushNativeMenuLanguage(): Promise<void> {
  if (!isTauriRuntime()) return;
  await tauriClient.setAppLanguage({ language: localeTag(getEffectiveLocale()) });
}

/**
 * Pushes once at startup and again on every change, returning the unsubscribe.
 * Mirrors `bindHelpMenuEvents`.
 */
export function bindNativeMenuLanguage() {
  const push = () => {
    void pushNativeMenuLanguage().catch(() => {
      // A menu that failed to rebuild must not take the app down.
    });
  };

  push();
  return subscribeToLanguage(push);
}
