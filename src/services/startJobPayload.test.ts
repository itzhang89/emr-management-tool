import { describe, expect, it } from "vitest";
import {
  applyRuntimeToSourcePayload,
  describeJobToStartJobPayload,
  formatSourceJobPayload,
  isSparkSubmitDescribe,
  parseSourceJobPayload
} from "./startJobPayload";
import type { JobRunSummary } from "@/types/domain";

function baseJob(overrides: Partial<JobRunSummary> = {}): JobRunSummary {
  return {
    id: "job-1",
    name: "my-job",
    state: "FAILED",
    virtualClusterId: "vc-1",
    createdAt: "2026-01-01T00:00:00Z",
    describeDetails: {
      arn: "arn:aws:emr-containers:...",
      clientToken: "tok",
      executionRoleArn: "arn:aws:iam::123:role/EmrRole",
      releaseLabel: "emr-7.0.0-latest",
      createdBy: "user",
      stateDetails: "failed",
      failureReason: "USER_ERROR",
      tags: { a: "b" },
      retryMaxAttempts: 3,
      retryCurrentAttemptCount: 1,
      jobDriver: {
        type: "sparkSubmit",
        entryPoint: "s3://bucket/app.jar",
        entryPointArguments: ["--env", "prod"],
        sparkSubmitParameters: "--conf spark.executor.cores=2"
      },
      configurationOverrides: {
        applicationConfiguration: [{ classification: "spark-defaults", properties: { "spark.app.name": "x" } }],
        monitoringConfiguration: { s3MonitoringConfiguration: { logUri: "s3://logs/" } }
      }
    },
    ...overrides
  };
}

describe("startJobPayload", () => {
  it("maps describe details to StartJobRun whitelist JSON", () => {
    const payload = describeJobToStartJobPayload(baseJob());
    expect(payload).toEqual({
      name: "my-job",
      virtualClusterId: "vc-1",
      executionRoleArn: "arn:aws:iam::123:role/EmrRole",
      releaseLabel: "emr-7.0.0-latest",
      jobDriver: {
        sparkSubmitJobDriver: {
          entryPoint: "s3://bucket/app.jar",
          entryPointArguments: ["--env", "prod"],
          sparkSubmitParameters: "--conf spark.executor.cores=2"
        }
      },
      configurationOverrides: {
        applicationConfiguration: [{ classification: "spark-defaults", properties: { "spark.app.name": "x" } }],
        monitoringConfiguration: { s3MonitoringConfiguration: { logUri: "s3://logs/" } }
      }
    });
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("tags");
    expect(payload).not.toHaveProperty("clientToken");
    expect(JSON.stringify(payload)).not.toContain("retry");
  });

  it("detects sparkSubmit vs sparkSql", () => {
    expect(isSparkSubmitDescribe(baseJob())).toBe(true);
    expect(
      isSparkSubmitDescribe(
        baseJob({
          describeDetails: {
            jobDriver: { type: "sparkSql", sparkSqlParameters: "SELECT 1" }
          }
        })
      )
    ).toBe(false);
  });

  it("throws when describe details or sparkSubmit driver missing", () => {
    expect(() => describeJobToStartJobPayload(baseJob({ describeDetails: undefined }))).toThrow(
      /describe/i
    );
    expect(() =>
      describeJobToStartJobPayload(
        baseJob({
          describeDetails: { jobDriver: { type: "sparkSql", sparkSqlParameters: "SELECT 1" } }
        })
      )
    ).toThrow(/sparkSubmit/i);
  });

  it("applyRuntimeToSourcePayload sets virtual cluster and resource overrides", () => {
    const payload = describeJobToStartJobPayload(baseJob());
    const next = applyRuntimeToSourcePayload(payload, "vc-new", {
      driverCores: 4,
      driverMemory: "8G",
      executorCores: 2,
      executorMemory: "4G",
      executorInstances: 5
    });
    expect(next.virtualClusterId).toBe("vc-new");
    expect(next.jobDriver.sparkSubmitJobDriver.sparkSubmitParameters).toContain("spark.driver.cores=4");
    const sparkDefaults = next.configurationOverrides?.applicationConfiguration?.find(
      (item) => (item as { classification?: string }).classification === "spark-defaults"
    ) as { properties: Record<string, string> } | undefined;
    expect(sparkDefaults?.properties["spark.executor.instances"]).toBe("5");
  });

  it("parses and formats source JSON", () => {
    const payload = describeJobToStartJobPayload(baseJob());
    const text = formatSourceJobPayload(payload);
    const parsed = parseSourceJobPayload(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.payload.name).toBe("my-job");
    expect(parseSourceJobPayload("{").ok).toBe(false);
  });
});
