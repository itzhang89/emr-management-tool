import { describe, expect, it } from "vitest";
import { applyResourceOverride } from "@/services/resourceOverride";
import type { ResolvedJobPayload } from "@/types/domain";

const payload: ResolvedJobPayload = {
  name: "daily-etl",
  virtualClusterId: "vc-1",
  executionRoleArn: "arn:aws:iam::123456789012:role/EMR",
  releaseLabel: "emr-7.2.0-latest",
  jobDriver: {
    sparkSubmitJobDriver: {
      entryPoint: "s3://bucket/app.jar",
      sparkSubmitParameters: "--class Main --conf spark.driver.cores=1 --conf spark.executor.instances=1"
    }
  },
  configurationOverrides: {
    applicationConfiguration: [
      {
        classification: "spark-defaults",
        properties: {
          "spark.driver.cores": "1",
          "spark.executor.instances": "1"
        }
      }
    ]
  }
};

describe("resourceOverride", () => {
  it("updates spark submit parameters and spark-defaults", () => {
    const next = applyResourceOverride(payload, {
      driverCores: 2,
      driverMemory: "4G",
      executorCores: 4,
      executorMemory: "8G",
      executorInstances: 3
    });

    expect(next.jobDriver.sparkSubmitJobDriver.sparkSubmitParameters).toContain("spark.driver.cores=2");
    expect(next.jobDriver.sparkSubmitJobDriver.sparkSubmitParameters).toContain("spark.executor.instances=3");
    expect(next.jobDriver.sparkSubmitJobDriver.sparkSubmitParameters).not.toContain("spark.driver.cores=1");

    const sparkDefaults = next.configurationOverrides?.applicationConfiguration?.[0] as {
      properties: Record<string, string>;
    };
    expect(sparkDefaults.properties["spark.driver.memory"]).toBe("4G");
    expect(sparkDefaults.properties["spark.executor.instances"]).toBe("3");
  });

  it("appends spark-defaults when missing", () => {
    const withoutDefaults: ResolvedJobPayload = {
      ...payload,
      configurationOverrides: undefined
    };
    const next = applyResourceOverride(withoutDefaults, {
      driverCores: 1,
      driverMemory: "1G",
      executorCores: 1,
      executorMemory: "1G",
      executorInstances: 1
    });
    const configs = next.configurationOverrides?.applicationConfiguration ?? [];
    expect(configs.some((item) => (item as { classification?: string }).classification === "spark-defaults")).toBe(true);
  });
});
