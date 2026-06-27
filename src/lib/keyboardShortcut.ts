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
  if (isMacPlatform()) {
    let shortcut = modKeyLabel();
    if (options?.shift) shortcut += "⇧";
    if (options?.alt) shortcut += "⌥";
    return `${shortcut}${key}`;
  }

  const parts = [modKeyLabel()];
  if (options?.shift) parts.push("Shift");
  if (options?.alt) parts.push("Alt");
  parts.push(key);
  return parts.join("+");
}
