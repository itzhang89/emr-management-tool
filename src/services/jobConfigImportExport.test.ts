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

  it("defaults imported boolean variables to lowercase true/false output", () => {
    const parsed = parseImportedJobConfigTemplate(
      JSON.stringify({
        name: "Daily ETL",
        payloadTemplate: "{\"name\":\"daily-etl\"}",
        customVariables: [{ name: "enabled", type: "boolean", defaultValue: false }]
      })
    );

    expect(parsed.customVariables[0]?.format).toBe("lowercase");
    expect(parsed.customVariables[0]?.description).toBe(
      'Default: unchecked → "false". Checked → "true"; unchecked → "false".'
    );
  });

  it("defaults imported enum variables to inferred display format", () => {
    const parsed = parseImportedJobConfigTemplate(
      JSON.stringify({
        name: "Daily ETL",
        payloadTemplate: "{\"name\":\"daily-etl\"}",
        customVariables: [{ name: "ENV", type: "enum", options: ["dev", "prod"] }]
      })
    );

    expect(parsed.customVariables[0]?.format).toBe("radio");
  });

  it("preserves explicit enum display format on import", () => {
    const parsed = parseImportedJobConfigTemplate(
      JSON.stringify({
        name: "Daily ETL",
        payloadTemplate: "{\"name\":\"daily-etl\"}",
        customVariables: [{ name: "ENV", type: "enum", options: ["dev", "prod"], format: "combobox" }]
      })
    );

    expect(parsed.customVariables[0]?.format).toBe("combobox");
  });
});
