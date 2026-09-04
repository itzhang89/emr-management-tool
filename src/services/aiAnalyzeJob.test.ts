import { describe, expect, it } from "vitest";
import {
  jobAnalysisPrompt,
  jobSessionTitle,
  sameJobTitle,
  type JobAnalyzeIntent
} from "./aiAnalyzeJob";

describe("jobSessionTitle", () => {
  it("keeps a job name with no run suffix unchanged", () => {
    expect(jobSessionTitle("etl-daily")).toBe("etl-daily");
    expect(jobSessionTitle("nightly copy")).toBe("nightly copy");
    expect(jobSessionTitle(undefined)).toBe("");
  });

  it("strips a trailing date suffix", () => {
    expect(jobSessionTitle("etl-daily-2026-08-31")).toBe("etl-daily");
    expect(jobSessionTitle("hourly_job_2026-08-31")).toBe("hourly_job");
    expect(jobSessionTitle("nightly job 2026-08-31")).toBe("nightly job");
  });

  it("strips date-and-time suffixes in several spellings", () => {
    expect(jobSessionTitle("etl-2026-08-31T03-00-00Z")).toBe("etl");
    expect(jobSessionTitle("etl-2026-08-31 03:00:00")).toBe("etl");
    expect(jobSessionTitle("etl-2026-08-31-030000")).toBe("etl");
  });

  it("strips compact timestamp suffixes", () => {
    expect(jobSessionTitle("etl_1693456789")).toBe("etl"); // epoch seconds
    expect(jobSessionTitle("etl_1693456789123")).toBe("etl"); // epoch millis
    expect(jobSessionTitle("hourly_job_20260831_030000")).toBe("hourly_job");
  });

  it("strips a shorthand yyMMdd date with optional time", () => {
    expect(jobSessionTitle("etl_260903")).toBe("etl");
    expect(jobSessionTitle("etl_260903_0245")).toBe("etl");
    expect(jobSessionTitle("hourly_job-260903-0245")).toBe("hourly_job");
  });

  it("reapplies until nothing more falls off", () => {
    // A date then an epoch suffix: each pass removes the trailing marker.
    expect(jobSessionTitle("etl-2026-08-31-1693456789")).toBe("etl");
  });

  it("does not strip an ordinary numeric tail or a year alone", () => {
    expect(jobSessionTitle("myjob-123")).toBe("myjob-123");
    expect(jobSessionTitle("release-2026")).toBe("release-2026");
  });

  it("falls back to the trimmed name when stripping would empty it", () => {
    expect(jobSessionTitle("2026-08-31")).toBe("2026-08-31");
  });
});

describe("sameJobTitle", () => {
  it("compares case-insensitively after trimming", () => {
    expect(sameJobTitle("etl-daily", "ETL-Daily ")).toBe(true);
    expect(sameJobTitle("etl-daily", "etl-weekly")).toBe(false);
    expect(sameJobTitle(undefined, "etl-daily")).toBe(false);
  });
});

describe("jobAnalysisPrompt", () => {
  it("names the job id and virtual cluster when known", () => {
    const intent: JobAnalyzeIntent = {
      jobId: "0000000381t77o3g8f5",
      jobName: "etl-daily",
      virtualClusterId: "eks-vc-123"
    };
    const prompt = jobAnalysisPrompt(intent);
    expect(prompt).toContain("0000000381t77o3g8f5");
    expect(prompt).toContain("eks-vc-123");
    expect(prompt).toMatch(/failed/);
  });

  it("omits the virtual cluster line when unknown", () => {
    const prompt = jobAnalysisPrompt({ jobId: "job-1" });
    expect(prompt).not.toContain("virtual cluster");
    expect(prompt).toContain("job-1");
  });
});
