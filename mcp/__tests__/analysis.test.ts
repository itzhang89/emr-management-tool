import { describe, it, expect } from "vitest";
import { extractErrorSections } from "../src/analysis/index";

describe("extractErrorSections", () => {
  describe("extracts error tail", () => {
    it("should collect ERROR and WARN lines", () => {
      const text = `23/08/01 10:00:01 INFO TaskSetManager: Starting task
23/08/01 10:00:02 ERROR SparkContext: Job failed with exception
23/08/01 10:00:03 WARN DAGScheduler: Job 100 failed
23/08/01 10:00:04 INFO TaskSetManager: Starting another task`;

      const result = extractErrorSections(text);
      expect(result.errorTail).toContainEqual(expect.stringContaining("ERROR"));
      expect(result.errorTail).toContainEqual(expect.stringContaining("WARN"));
      expect(result.errorTail.length).toBeGreaterThanOrEqual(2);
    });

    it("should return empty errorTail for empty text", () => {
      const result = extractErrorSections("");
      expect(result.errorTail).toEqual([]);
    });
  });

  describe("extracts tracebacks", () => {
    it("should extract Spark exception and stack frame", () => {
      const text = `23/08/01 10:00:02 ERROR SparkContext: Job aborted
Exception in thread "main" org.apache.spark.SparkException: Job aborted
  at org.apache.spark.SparkContext.runJob(SparkContext.scala:2046)
  at org.apache.spark.SparkContext.runJob(SparkContext.scala:2016)
  ... 15 more`;

      const result = extractErrorSections(text);
      expect(result.tracebacks.length).toBeGreaterThan(0);
      expect(result.tracebacks[0]).toContain("SparkException");
      expect(result.tracebacks[0]).toContain("at org.apache.spark");
    });

    it("should extract Caused by chains", () => {
      const text = `Exception in thread "main" java.lang.RuntimeException: outer error
Caused by: java.io.IOException: inner error
  at java.io.FileInputStream.open0(FileInputStream.java:195)
Caused by: java.net.SocketTimeoutException: Connection timed out
  at sun.nio.ch.Net.pollConnect(Native Method)`;

      const result = extractErrorSections(text);
      expect(result.tracebacks.length).toBeGreaterThan(0);
    });
  });

  describe("deepestCausedBy", () => {
    it("should return the last Caused by", () => {
      const text = `Exception in thread "main" java.lang.RuntimeException: Stage failed
Caused by: org.apache.spark.SparkException: Job aborted
Caused by: java.io.IOException: Connection to database failed
Caused by: java.net.SocketTimeoutException: Connection timed out`;

      const result = extractErrorSections(text);
      expect(result.deepestCausedBy).toBe("java.net.SocketTimeoutException: Connection timed out");
    });

    it("should return null when no Caused by exists", () => {
      const text = "ERROR MyLogger: Something went wrong";
      const result = extractErrorSections(text);
      expect(result.deepestCausedBy).toBeNull();
    });
  });

  describe("candidateCauses", () => {
    it("should detect OOM", () => {
      const text = "ERROR SparkContext: Container killed by YARN for exceeding memory limits";
      const result = extractErrorSections(text);
      expect(result.candidateCauses).toContainEqual(expect.objectContaining({
        cause: "OOM / executors killed",
        confidence: "high",
      }));
    });

    it("should detect AccessDenied", () => {
      const text = "ERROR S3Client: AccessDenied: User is not authorized to perform s3:GetObject";
      const result = extractErrorSections(text);
      expect(result.candidateCauses).toContainEqual(expect.objectContaining({
        cause: "S3/IAM permission denied",
        confidence: "high",
      }));
    });

    it("should detect ClassNotFoundException", () => {
      const text = "ERROR SparkContext: ClassNotFoundException: com.example.MyClass";
      const result = extractErrorSections(text);
      expect(result.candidateCauses).toContainEqual(expect.objectContaining({
        cause: "Missing jar or classpath dependency",
        confidence: "high",
      }));
    });

    it("should detect ParseException", () => {
      const text = "ERROR SQLExecution: ParseException: mismatched input 'SELECT'";
      const result = extractErrorSections(text);
      expect(result.candidateCauses).toContainEqual(expect.objectContaining({
        cause: "Bad SQL or script syntax",
        confidence: "high",
      }));
    });

    it("should detect Cancelled job", () => {
      const text = "ERROR EMRClient: Job cancelled by user, state = CANCELLED";
      const result = extractErrorSections(text);
      expect(result.candidateCauses).toContainEqual(expect.objectContaining({
        cause: "Job cancelled by user",
        confidence: "high",
      }));
    });

    it("should detect script exit code failure", () => {
      const text = "ERROR ETLLogger: Script returned exit code 1, command not found: aws";
      const result = extractErrorSections(text);
      expect(result.candidateCauses).toContainEqual(expect.objectContaining({
        cause: "Script exit code failure",
        confidence: "medium",
      }));
    });

    it("should detect disk space exhaustion", () => {
      const text = "ERROR TaskSchedulerImpl: No space left on device";
      const result = extractErrorSections(text);
      expect(result.candidateCauses).toContainEqual(expect.objectContaining({
        cause: "Disk space exhausted",
        confidence: "high",
      }));
    });
  });

  describe("stepIds", () => {
    it("should extract ETL step IDs", () => {
      const text = `-- stepId=101
23/08/01 10:00:02 INFO ETLLogger: Starting ETL step
-- stepId=202
23/08/01 10:00:03 INFO ETLLogger: Processing records`;

      const result = extractErrorSections(text);
      expect(result.stepIds).toContain("101");
      expect(result.stepIds).toContain("202");
    });

    it("should return empty stepIds for text without step markers", () => {
      const text = "ERROR SparkContext: Job failed";
      const result = extractErrorSections(text);
      expect(result.stepIds).toEqual([]);
    });
  });
});