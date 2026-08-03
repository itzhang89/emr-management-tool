import { describe, expect, it } from "vitest";
import { cliImportPromptReason, shouldPromptCliImport } from "./cliProfileImport";

describe("shouldPromptCliImport", () => {
  it("imports directly when region is set and the name is free", () => {
    expect(
      shouldPromptCliImport({ profileName: "dev", region: "eu-west-1" }, [{ name: "prod" }])
    ).toBe(false);
  });

  it("prompts when region is missing", () => {
    expect(shouldPromptCliImport({ profileName: "dev", region: undefined }, [])).toBe(true);
    expect(shouldPromptCliImport({ profileName: "dev", region: "  " }, [])).toBe(true);
  });

  it("prompts when the account name is already taken", () => {
    expect(
      shouldPromptCliImport({ profileName: "dev", region: "us-east-1" }, [{ name: "dev" }])
    ).toBe(true);
  });
});

describe("cliImportPromptReason", () => {
  it("explains duplicate names", () => {
    expect(
      cliImportPromptReason({ profileName: "dev", region: "us-east-1" }, [{ name: "dev" }])
    ).toMatch(/already exists/i);
  });

  it("explains missing region", () => {
    expect(cliImportPromptReason({ profileName: "dev" }, [])).toMatch(/no region/i);
  });
});
