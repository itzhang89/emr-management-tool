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
});
