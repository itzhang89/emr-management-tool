import { describe, expect, it } from "vitest";
import { formatCloudWatchMessages, MAX_LOG_VIEW_CHARACTERS, truncateLogTextForDisplay } from "./logDisplay";

describe("truncateLogTextForDisplay", () => {
  it("returns the original text when it fits the display budget", () => {
    const text = "line one\nline two";
    expect(truncateLogTextForDisplay(text)).toEqual({
      text,
      truncated: false,
      totalCharacters: text.length
    });
  });

  it("truncates very large logs without embedding a suffix in the preview text", () => {
    const text = "x".repeat(MAX_LOG_VIEW_CHARACTERS + 100);
    const result = truncateLogTextForDisplay(text);

    expect(result.truncated).toBe(true);
    expect(result.totalCharacters).toBe(text.length);
    expect(result.text).toHaveLength(MAX_LOG_VIEW_CHARACTERS);
    expect(result.text).not.toContain("Download the log");
  });
});

describe("formatCloudWatchMessages", () => {
  it("joins CloudWatch entry messages with newlines", () => {
    expect(
      formatCloudWatchMessages([
        { message: "first" },
        { message: undefined },
        { message: "second" }
      ])
    ).toBe("first\n\nsecond");
  });
});
