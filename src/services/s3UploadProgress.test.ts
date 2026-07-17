import { describe, expect, it } from "vitest";
import { formatUploadBytes, formatUploadPhase } from "./s3UploadProgress";

describe("s3UploadProgress", () => {
  it("formats upload phases for the UI", () => {
    expect(formatUploadPhase("preparing")).toBe("Preparing");
    expect(formatUploadPhase("reading")).toBe("Reading");
    expect(formatUploadPhase("uploading")).toBe("Uploading");
    expect(formatUploadPhase("completing")).toBe("Finalizing");
    expect(formatUploadPhase("completed")).toBe("Uploaded");
  });

  it("formats byte counts for progress labels", () => {
    expect(formatUploadBytes(512)).toBe("512 B");
    expect(formatUploadBytes(1536)).toBe("1.50 KB");
    expect(formatUploadBytes(5 * 1024 * 1024)).toBe("5.00 MB");
    expect(formatUploadBytes(1.25 * 1024 * 1024 * 1024)).toBe("1.25 GB");
  });
});
