import { describe, expect, it } from "vitest";
import { cliImportPromptReason, findAccountForProfileKey, shouldPromptCliImport } from "./cliProfileImport";

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

describe("findAccountForProfileKey", () => {
  it("matches the account that already uses the same access key", () => {
    const account = { name: "prod", accessKeyIdMasked: "AKIA****WXYZ" };
    expect(findAccountForProfileKey({ accessKeyIdMasked: "AKIA****WXYZ" }, [account])).toBe(account);
  });

  it("ignores case and surrounding whitespace", () => {
    const account = { name: "prod", accessKeyIdMasked: " akia****wxyz " };
    expect(findAccountForProfileKey({ accessKeyIdMasked: "AKIA****WXYZ" }, [account])).toBe(account);
  });

  it("returns null when no account uses the key", () => {
    expect(
      findAccountForProfileKey({ accessKeyIdMasked: "AKIA****WXYZ" }, [
        { name: "prod", accessKeyIdMasked: "AKIB****1234" }
      ])
    ).toBeNull();
  });

  it("treats a profile without a static key as never imported", () => {
    expect(
      findAccountForProfileKey({ accessKeyIdMasked: undefined }, [{ name: "prod", accessKeyIdMasked: "AKIA****WXYZ" }])
    ).toBeNull();
  });
});
