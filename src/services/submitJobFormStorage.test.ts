import { beforeEach, describe, expect, it } from "vitest";
import {
  readSubmitJobFormCache,
  readSubmitJobLastTemplate,
  submitJobFormStorageKey,
  submitJobLastTemplateStorageKey,
  writeSubmitJobFormCache,
  writeSubmitJobLastTemplate
} from "./submitJobFormStorage";

describe("submitJobFormStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("uses account and template scoped storage keys", () => {
    expect(submitJobFormStorageKey("acct-a", "daily-etl")).toBe("emr-eks:submit-job-form:acct-a:daily-etl");
    expect(submitJobLastTemplateStorageKey("acct-a")).toBe("emr-eks:submit-job-last-template:acct-a");
  });

  it("stores and reads cached submit form values per template", () => {
    writeSubmitJobFormCache("acct-a", "daily-etl", {
      resourceTemplateId: "medium",
      customVariables: { ENV: "prod", TAGS: ["a", "b"], ENABLED: true, RETRIES: 2 }
    });

    expect(readSubmitJobFormCache("acct-a", "daily-etl")).toEqual({
      resourceTemplateId: "medium",
      customVariables: { ENV: "prod", TAGS: ["a", "b"], ENABLED: true, RETRIES: 2 }
    });
    expect(readSubmitJobFormCache("acct-a", "other-template")).toBeUndefined();
  });

  it("stores and reads the last selected template per account", () => {
    writeSubmitJobLastTemplate("acct-a", "daily-etl");
    writeSubmitJobLastTemplate("acct-b", "batch-etl");

    expect(readSubmitJobLastTemplate("acct-a")).toBe("daily-etl");
    expect(readSubmitJobLastTemplate("acct-b")).toBe("batch-etl");
  });
});
