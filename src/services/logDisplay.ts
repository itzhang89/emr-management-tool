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

  const suffix = `\n\n… Log truncated for display (${formatCharacterCount(text.length)} characters total). Download the log to view the full file.`;
  const maxPrefix = Math.max(0, MAX_LOG_VIEW_CHARACTERS - suffix.length);

  return {
    text: `${text.slice(0, maxPrefix)}${suffix}`,
    truncated: true,
    totalCharacters: text.length
  };
}

function formatCharacterCount(count: number) {
  return count.toLocaleString("en-US");
}
