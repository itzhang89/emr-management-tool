import { describe, expect, it } from "vitest";
import {
  BUILTIN_TEMPLATE_VARIABLES,
  TEMPLATE_VARIABLE_PATTERN,
  buildVariableMap,
  replaceTemplateVariables,
  resolveTemplatePayload,
  toStartJobRunRequest,
  validateSubmitPayload
} from "@/services/templateEngine";
import type { JobConfigTemplate } from "@/types/domain";

const template: JobConfigTemplate = {
  id: "test",
  name: "Daily ETL",
  payloadTemplate: `{
    "name": "\${template_name}-\${submitUser}-\${date:YYYY-MM-DD}",
    "virtualClusterId": "\${virtualClusterId}",
    "executionRoleArn": "arn:aws:iam::123456789012:role/EMR",
    "releaseLabel": "emr-7.2.0-latest",
    "jobDriver": {
      "sparkSubmitJobDriver": {
        "entryPoint": "s3://bucket/app.jar",
        "entryPointArguments": ["--env=\${ENV}"],
        "sparkSubmitParameters": "--class com.example.Main"
      }
    }
  }`,
  customVariables: [
    {
      name: "ENV",
      type: "enum",
      options: ["dev", "prod"],
      required: true,
      defaultValue: "prod"
    }
  ],
  createdAt: "2026-06-10T00:00:00Z",
  updatedAt: "2026-06-10T00:00:00Z"
};

describe("templateEngine", () => {
  it("exports built-in template variables and a reusable scan pattern", () => {
    expect([...BUILTIN_TEMPLATE_VARIABLES]).toEqual([
      "template_name",
      "virtualClusterId",
      "submitUser",
      "AWS_USERNAME",
      "AWS_ACCOUNT_ID",
      "AWS_REGION",
      "date",
      "datetime"
    ]);
    TEMPLATE_VARIABLE_PATTERN.lastIndex = 0;
    expect(TEMPLATE_VARIABLE_PATTERN.test("${ENV}")).toBe(true);
  });

  it("replaces built-in and custom variables", () => {
    const resolved = resolveTemplatePayload(template, {
      virtualClusterId: "vc-123",
      submitUser: "john_doe",
      customVariables: { ENV: "dev" },
      now: new Date("2026-06-14T10:15:00Z")
    });

    expect(resolved.name).toBe("Daily ETL-john_doe-2026-06-14");
    expect(resolved.virtualClusterId).toBe("vc-123");
    expect(resolved.jobDriver.sparkSubmitJobDriver.entryPointArguments).toEqual(["--env=dev"]);
  });

  it("resolves AWS variables and submitUser", () => {
    const awsTemplate = {
      ...template,
      payloadTemplate: '{"name":"${template_name}-${submitUser}-${AWS_USERNAME}-${AWS_ACCOUNT_ID}-${AWS_REGION}"}'
    };
    expect(resolveTemplatePayload(awsTemplate, {
      virtualClusterId: "vc-123",
      submitUser: "tester",
      account: {
        identity: { arn: "arn:aws-cn:iam::123456789012:user/platform/alice", account: "123456789012", userId: "id" },
        region: "cn-north-1"
      },
      customVariables: {},
      accountVariables: { AWS_USERNAME: "override" }
    }).name).toBe("Daily ETL-tester-alice-123456789012-cn-north-1");
  });

  it.each([
    "arn:aws:iam::123456789012:root",
    "arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_Admin/alice"
  ])("reports AWS_USERNAME as missing without an IAM user identity (%s)", (arn) => {
    expect(() => resolveTemplatePayload({ ...template, payloadTemplate: '{"name":"${AWS_USERNAME}"}' }, {
      virtualClusterId: "vc-123",
      submitUser: "tester",
      account: { identity: { arn, account: "123456789012", userId: "id" }, region: "us-east-1" },
      customVariables: {}
    })).toThrow(expect.objectContaining({ variables: ["AWS_USERNAME"] }));
  });

  it("renders account-only values and safely substitutes JSON strings", () => {
    const value = 's3://bucket/quote"and\\slash';
    const resolved = resolveTemplatePayload(
      { ...template, payloadTemplate: template.payloadTemplate.replace("s3://bucket/app.jar", "${ENTRY_POINT}") },
      {
        virtualClusterId: "vc-123",
        submitUser: "tester",
        customVariables: { ENV: "dev" },
        accountVariables: { ENTRY_POINT: value, ENV: "prod" }
      }
    );
    expect(resolved.jobDriver.sparkSubmitJobDriver.entryPoint).toBe(value);
    expect(resolved.jobDriver.sparkSubmitJobDriver.entryPointArguments).toEqual(["--env=prod"]);
  });

  it("formats date variables with custom patterns", () => {
    const output = replaceTemplateVariables(
      "${date:YYYY/MM/DD}",
      buildVariableMap(
        template,
        {
          virtualClusterId: "vc-123",
          submitUser: "tester",
          customVariables: {}
        },
        new Date("2026-06-14T10:15:00Z")
      ),
      new Date("2026-06-14T10:15:00Z")
    );
    expect(output).toBe("2026/06/14");
  });

  it("uses year-month-day hour-minute-second as the default datetime format", () => {
    const output = replaceTemplateVariables(
      "${datetime}",
      buildVariableMap(
        template,
        {
          virtualClusterId: "vc-123",
          submitUser: "tester",
          customVariables: {}
        },
        new Date(2026, 5, 14, 10, 15, 30)
      ),
      new Date(2026, 5, 14, 10, 15, 30)
    );
    expect(output).toBe("2026-06-14 10:15:30");
  });

  it("validates required custom variables and payload shape", () => {
    const resolved = resolveTemplatePayload({ ...template, name: "Daily-ETL" }, {
      virtualClusterId: "vc-123",
      submitUser: "tester",
      customVariables: { ENV: "prod" },
      now: new Date("2026-06-14T10:15:00Z")
    });
    const invalid = validateSubmitPayload(resolved, template.customVariables, {});
    expect(invalid.ok).toBe(false);

    const valid = validateSubmitPayload(resolved, template.customVariables, { ENV: "prod" });
    expect(valid.ok).toBe(true);
  });

  it("rejects EMR job names with characters that StartJobRun does not allow", () => {
    const resolved = resolveTemplatePayload(template, {
      virtualClusterId: "vc-123",
      submitUser: "tester",
      customVariables: { ENV: "prod" },
      now: new Date("2026-06-14T10:15:00Z")
    });

    const invalid = validateSubmitPayload(resolved, template.customVariables, { ENV: "prod" });

    expect(invalid.ok).toBe(false);
    expect(invalid.errors).toContain(
      "Job name can only contain letters, numbers, dot, hyphen, underscore, slash, or #. Replace spaces with hyphens or underscores."
    );
  });

  it("builds a start job request from resolved payload", () => {
    const resolved = resolveTemplatePayload(template, {
      virtualClusterId: "vc-123",
      submitUser: "tester",
      customVariables: { ENV: "prod" },
      now: new Date("2026-06-14T10:15:00Z")
    });
    const request = toStartJobRunRequest(resolved, {
      driverCores: 2,
      driverMemory: "4G",
      executorCores: 2,
      executorMemory: "4G",
      executorInstances: 2
    });

    expect(request.jobDriver.sparkSubmitJobDriver.entryPoint).toBe("s3://bucket/app.jar");
    expect(request.jobDriver.sparkSubmitJobDriver.sparkSubmitParameters).toContain("spark.driver.cores=2");
    expect(request.application.mainClass).toBe("com.example.Main");
  });

  it("formats boolean variables using format", () => {
    const booleanTemplate: JobConfigTemplate = {
      ...template,
      payloadTemplate: `{
        "name": "bool-test",
        "virtualClusterId": "\${virtualClusterId}",
        "executionRoleArn": "arn:aws:iam::123456789012:role/EMR",
        "releaseLabel": "emr-7.2.0-latest",
        "jobDriver": {
          "sparkSubmitJobDriver": {
            "entryPoint": "s3://bucket/app.jar",
            "entryPointArguments": ["--flag=\${enabled}", "--count=\${enabled_numeric}"],
            "sparkSubmitParameters": "--class com.example.Main"
          }
        }
      }`,
      customVariables: [
        { name: "enabled", type: "boolean", defaultValue: false, format: "capitalized" },
        { name: "enabled_numeric", type: "boolean", defaultValue: true, format: "numeric" }
      ]
    };

    const resolved = resolveTemplatePayload(booleanTemplate, {
      virtualClusterId: "vc-123",
      submitUser: "tester",
      customVariables: { enabled: true, enabled_numeric: false },
      now: new Date("2026-06-14T10:15:00Z")
    });

    expect(resolved.jobDriver.sparkSubmitJobDriver.entryPointArguments).toEqual(["--flag=True", "--count=0"]);
  });

  it("defaults boolean output to lowercase true/false", () => {
    const variables = buildVariableMap(
      {
        ...template,
        customVariables: [{ name: "enabled", type: "boolean", defaultValue: false }]
      },
      {
        virtualClusterId: "vc-123",
        submitUser: "tester",
        customVariables: { enabled: true }
      },
      new Date("2026-06-14T10:15:00Z")
    );

    expect(variables.enabled).toBe("true");
  });
});
