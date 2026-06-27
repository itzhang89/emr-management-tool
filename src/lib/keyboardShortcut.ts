function isMacPlatform() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.platform);
}

export function modKeyLabel() {
  return isMacPlatform() ? "⌘" : "Ctrl";
}

export function formatModShortcut(
  key: string,
  options?: {
    shift?: boolean;
    alt?: boolean;
  }
) {
  const parts = [modKeyLabel()];
  if (options?.shift) parts.push(isMacPlatform() ? "⇧" : "Shift");
  if (options?.alt) parts.push(isMacPlatform() ? "⌥" : "Alt");
  parts.push(key);
  return parts.join("+");
}

export function formatShortcutsHelpLabel() {
  return formatModShortcut("/", { shift: true });
}

export function isShortcutsHelpKey(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey">
) {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod || !event.shiftKey) return false;

  return event.key === "/" || event.code === "Slash" || event.key === "?" || event.key === "¿";
}

export function isSidebarToggleKey(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">
) {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod || event.shiftKey || event.altKey) return false;

  return event.key === "/" || event.code === "Slash";
}

function hasPrimaryModShortcutModifiers(
  event: Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey" | "altKey">
) {
  const mod = event.metaKey || event.ctrlKey;
  return mod && !event.shiftKey && !event.altKey;
}

export function isAccountSwitchKey(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">
) {
  if (!hasPrimaryModShortcutModifiers(event)) return false;

  return event.key === "e" || event.key === "E";
}

export function getPageNavigationIndex(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">
) {
  if (!hasPrimaryModShortcutModifiers(event)) return null;
  if (event.key >= "1" && event.key <= "9") {
    return Number(event.key);
  }

  return null;
}

export function isPageCyclePreviousKey(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">
) {
  if (!hasPrimaryModShortcutModifiers(event)) return false;

  return event.key === "[" || event.code === "BracketLeft";
}

export function isPageCycleNextKey(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">
) {
  if (!hasPrimaryModShortcutModifiers(event)) return false;

  return event.key === "]" || event.code === "BracketRight";
}
