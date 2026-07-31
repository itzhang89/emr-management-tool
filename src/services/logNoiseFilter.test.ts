import { describe, expect, it } from "vitest";
import { filterLogNoise } from "./logNoiseFilter";

const spark = (level: string, logger: string, message: string) =>
  `26/07/31 11:30:32 ${level} ${logger}: ${message}`;

describe("filterLogNoise", () => {
  it("drops blacklisted INFO loggers and counts hidden lines", () => {
    const input = [
      spark("INFO", "TaskSetManager", "Starting task 0.0 in stage 0.0 (TID 0)"),
      spark("INFO", "DAGScheduler", "Job 0 finished: count at Foo.scala:1, took 1.0 s"),
      spark("INFO", "ETLLogger", "Executing job dct__t_message_opened_snapshot")
    ].join("\n");

    const result = filterLogNoise(input);
    expect(result.hiddenCount).toBe(2);
    expect(result.text).toBe(spark("INFO", "ETLLogger", "Executing job dct__t_message_opened_snapshot"));
  });

  it("never drops WARN or ERROR even for blacklisted loggers", () => {
    const input = [
      spark("WARN", "TaskSetManager", "Lost task 0.0"),
      spark("ERROR", "DAGScheduler", "Job aborted"),
      spark("INFO", "TaskSetManager", "Finished task 0.0")
    ].join("\n");

    const result = filterLogNoise(input);
    expect(result.hiddenCount).toBe(1);
    expect(result.text).toContain("WARN TaskSetManager");
    expect(result.text).toContain("ERROR DAGScheduler");
    expect(result.text).not.toContain("Finished task");
  });

  it("applies Executor / SparkContext / Utils / SQLExecution message rules", () => {
    const input = [
      spark("INFO", "Executor", "Running task 1.0 in stage 2.0 (TID 3)"),
      spark("INFO", "Executor", "Finished task 1.0 in stage 2.0 (TID 3). 100 bytes result sent to driver"),
      spark("INFO", "Executor", "Starting executor ID 1 on host 100.64.24.188"),
      spark("INFO", "Executor", "1 block locks were not released by task 1.0"),
      spark("INFO", "SparkContext", "Created broadcast 1 from broadcast at DAGScheduler.scala:1"),
      spark("INFO", "SparkContext", "Submitted application: spark-000000037tm733505h0"),
      spark("INFO", "SparkContext", "Running Spark version 3.5.6-amzn-2"),
      spark("INFO", "Utils", "Successfully started service 'sparkDriver' on port 7078."),
      spark("INFO", "Utils", "Copying /tmp/foo to /home/hadoop/foo"),
      spark("INFO", "SQLExecution", "Generating and posting SparkListenerSQLExecutionObfuscatedInfo..."),
      spark("INFO", "SQLExecution", "Posted SparkListenerSQLExecutionObfuscatedInfo in 7 ms")
    ].join("\n");

    const result = filterLogNoise(input);
    expect(result.text).toContain("Starting executor ID 1");
    expect(result.text).toContain("Submitted application");
    expect(result.text).toContain("Running Spark version");
    expect(result.text).toContain("Successfully started service 'sparkDriver'");
    expect(result.text).not.toContain("Running task");
    expect(result.text).not.toContain("Finished task");
    expect(result.text).not.toContain("block locks were not released");
    expect(result.text).not.toContain("Created broadcast");
    expect(result.text).not.toContain("Copying /tmp/foo");
    expect(result.text).not.toContain("SparkListenerSQLExecutionObfuscatedInfo");
  });

  it("drops SLF4J lines but keeps Files s3://, SQL blocks, and unknown loggers", () => {
    const input = [
      'SLF4J: Failed to load class "org.slf4j.impl.StaticLoggerBinder".',
      "Files s3://bucket/jars/app.jar from /tmp/app.jar to /home/hadoop/app.jar",
      "-- stepId=1",
      "select 1;",
      spark("INFO", "MicroBatchExecution", "Streaming query made progress"),
      spark("INFO", "TotallyNewBusinessLogger", "keep me")
    ].join("\n");

    const result = filterLogNoise(input);
    expect(result.hiddenCount).toBe(1);
    expect(result.text).toContain("Files s3://");
    expect(result.text).toContain("-- stepId=1");
    expect(result.text).toContain("select 1;");
    expect(result.text).toContain("MicroBatchExecution");
    expect(result.text).toContain("TotallyNewBusinessLogger");
    expect(result.text).not.toContain("SLF4J:");
  });

  it("strips inner-class suffixes when matching logger names", () => {
    const input = spark(
      "INFO",
      "KubernetesClusterSchedulerBackend$KubernetesDriverEndpoint",
      "Registered executor NettyRpcEndpointRef"
    );
    const kept = filterLogNoise(input);
    expect(kept.hiddenCount).toBe(0);

    const noise = filterLogNoise(
      spark("INFO", "BlockManagerInfo$Something", "Added broadcast_1_piece0 in memory")
    );
    expect(noise.hiddenCount).toBe(1);
  });

  it("returns empty text and zero hidden for empty input", () => {
    expect(filterLogNoise("")).toEqual({ text: "", hiddenCount: 0 });
  });
});
