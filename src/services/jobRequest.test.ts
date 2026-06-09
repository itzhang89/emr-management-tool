import { describe, expect, it } from "vitest";
import { buildStartJobRunRequest } from "./jobRequest";

describe("buildStartJobRunRequest", () => {
  it("builds a Jar Spark submit request with arguments, resources, and Spark config", () => {
    const request = buildStartJobRunRequest({
      name: "daily-etl",
      virtualClusterId: "vc-123",
      executionRoleArn: "arn:aws:iam::123456789012:role/emr-job",
      releaseLabel: "emr-7.2.0-latest",
      application: {
        type: "jar",
        jarPath: "s3://bucket/jobs/app.jar",
        mainClass: "com.example.Main"
      },
      arguments: ["--date=2026-06-09", "--env=prod"],
      resources: {
        driverCores: 1,
        driverMemory: "2G",
        executorCores: 2,
        executorMemory: "4G",
        executorInstances: 3
      },
      sparkConfig: {
        "spark.sql.shuffle.partitions": "200"
      }
    });

    expect(request).toMatchObject({
      name: "daily-etl",
      virtualClusterId: "vc-123",
      executionRoleArn: "arn:aws:iam::123456789012:role/emr-job",
      jobDriver: {
        sparkSubmitJobDriver: {
          entryPoint: "s3://bucket/jobs/app.jar",
          entryPointArguments: ["--date=2026-06-09", "--env=prod"],
          sparkSubmitParameters: "--class com.example.Main --conf spark.driver.cores=1 --conf spark.driver.memory=2G --conf spark.executor.cores=2 --conf spark.executor.memory=4G --conf spark.executor.instances=3 --conf spark.sql.shuffle.partitions=200"
        }
      }
    });
  });
});
