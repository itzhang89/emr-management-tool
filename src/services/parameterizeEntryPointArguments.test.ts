import { describe, expect, it } from "vitest";
import {
  kebabFlagToCamelCase,
  parameterizeEntryPointArguments,
  parameterizeSourcePayloadForTemplate
} from "./parameterizeEntryPointArguments";
import type { ResolvedJobPayload } from "@/types/domain";

describe("parameterizeEntryPointArguments", () => {
  it("converts kebab flags to camelCase variable names", () => {
    expect(kebabFlagToCamelCase("--latest-only")).toBe("latestOnly");
    expect(kebabFlagToCamelCase("default-start")).toBe("defaultStart");
    expect(kebabFlagToCamelCase("env")).toBe("env");
  });

  it("promotes key=value entry point args into typed template variables", () => {
    const result = parameterizeEntryPointArguments([
      "batch-job",
      "--latest-only=false",
      "--merge-job=false",
      "--names=shiji_transaction",
      "--period=5",
      "--env=qa",
      "--property=s3://manila-bigdata-etl/conf/etl-qa.properties",
      "--default-start=2026-05-16 23:00:00"
    ]);

    expect(result.arguments).toEqual([
      "batch-job",
      "--latest-only=${latestOnly}",
      "--merge-job=${mergeJob}",
      "--names=${names}",
      "--period=${period}",
      "--env=${env}",
      "--property=${property}",
      "--default-start=${defaultStart}"
    ]);

    expect(result.customVariables).toEqual([
      {
        name: "latestOnly",
        label: "Latest Only",
        type: "boolean",
        defaultValue: false,
        required: true
      },
      {
        name: "mergeJob",
        label: "Merge Job",
        type: "boolean",
        defaultValue: false,
        required: true
      },
      {
        name: "names",
        label: "Names",
        type: "text",
        defaultValue: "shiji_transaction",
        required: true
      },
      {
        name: "period",
        label: "Period",
        type: "number",
        defaultValue: 5,
        required: true
      },
      {
        name: "env",
        label: "Env",
        type: "text",
        defaultValue: "qa",
        required: true
      },
      {
        name: "property",
        label: "Property",
        type: "text",
        defaultValue: "s3://manila-bigdata-etl/conf/etl-qa.properties",
        required: true
      },
      {
        name: "defaultStart",
        label: "Default Start",
        type: "dateTime",
        format: "YYYY-MM-DD HH:mm:ss",
        defaultValue: "2026-05-16 23:00:00",
        required: true
      }
    ]);
  });

  it("parameterizes key=value args without requiring a -- prefix", () => {
    const result = parameterizeEntryPointArguments([
      "batch-job",
      "latest-only=false",
      "env=qa",
      "period=5"
    ]);

    expect(result.arguments).toEqual([
      "batch-job",
      "latest-only=${latestOnly}",
      "env=${env}",
      "period=${period}"
    ]);
    expect(result.customVariables.map((variable) => variable.name)).toEqual([
      "latestOnly",
      "env",
      "period"
    ]);
  });

  it("rewrites source payload entryPointArguments when creating a template", () => {
    const payload: ResolvedJobPayload = {
      name: "job",
      virtualClusterId: "vc-1",
      executionRoleArn: "arn:role",
      releaseLabel: "emr-7.0.0-latest",
      jobDriver: {
        sparkSubmitJobDriver: {
          entryPoint: "s3://bucket/app.jar",
          entryPointArguments: ["batch-job", "env=qa", "--period=5"],
          sparkSubmitParameters: ""
        }
      }
    };

    const result = parameterizeSourcePayloadForTemplate(payload);
    const parsed = JSON.parse(result.payloadTemplate) as ResolvedJobPayload;

    expect(parsed.jobDriver.sparkSubmitJobDriver.entryPointArguments).toEqual([
      "batch-job",
      "env=${env}",
      "--period=${period}"
    ]);
    expect(result.customVariables.map((variable) => variable.name)).toEqual(["env", "period"]);
  });
});
