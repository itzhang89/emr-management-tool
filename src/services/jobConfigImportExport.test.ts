import { describe, expect, it } from "vitest";
import { parseImportedJobConfigTemplate, serializeJobConfigTemplate } from "@/services/jobConfigImportExport";

describe("jobConfigImportExport", () => {
  it("round-trips template export payload", () => {
    const template = {
      name: "Daily ETL",
      description: "Example",
      payloadTemplate: "{\"name\":\"daily-etl\"}",
      customVariables: [{ name: "ENV", type: "enum" as const, options: ["dev", "prod"], defaultValue: "dev" }],
      defaultResourceTemplateId: "tiny"
    };

    const parsed = parseImportedJobConfigTemplate(serializeJobConfigTemplate(template));
    expect(parsed.name).toBe("Daily ETL");
    expect(parsed.customVariables[0]?.defaultValue).toBe("dev");
  });

  it("defaults imported variables to required when omitted", () => {
    const parsed = parseImportedJobConfigTemplate(
      JSON.stringify({
        name: "Daily ETL",
        payloadTemplate: "{\"name\":\"daily-etl\"}",
        customVariables: [{ name: "RUN_AT", type: "dateTime" }]
      })
    );

    expect(parsed.customVariables[0]?.required).toBe(true);
    expect(parsed.customVariables[0]?.format).toBe("YYYY-MM-DD HH:mm:ss");
  });
});
