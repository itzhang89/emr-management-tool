export const MAX_LOG_VIEW_CHARACTERS = 512_000;

export function formatCloudWatchMessages(entries: Array<{ message?: string }>) {
  return entries.map((entry) => entry.message ?? "").join("\n");
}

export function truncateLogTextForDisplay(text: string): {
  text: string;
  truncated: boolean;
  totalCharacters: number;
} {
  if (text.length <= MAX_LOG_VIEW_CHARACTERS) {
    return { text, truncated: false, totalCharacters: text.length };
  }

  return {
    text: text.slice(0, MAX_LOG_VIEW_CHARACTERS),
    truncated: true,
    totalCharacters: text.length
  };
}
