import { describe, expect, it } from "vitest";
import {
  formatAccountTemplateVariablesEnv,
  parseAccountTemplateVariablesEnv
} from "@/services/accountTemplateVariablesEnv";

describe("account template variables .env format", () => {
  it("reads comments, quoted and multiline values, empty strings and literal references", () => {
    const text = [
      "# a comment",
      "export SPACE = ' leading and trailing ' # comment",
      'HASH="a#b=c"',
      "EMPTY=",
      "REFERENCE=\${SPACE}",
      "MULTILINE='first  ",
      "second'"
    ].join("\r\n");
    expect(parseAccountTemplateVariablesEnv(text)).toEqual({
      SPACE: " leading and trailing ",
      HASH: "a#b=c",
      EMPTY: "",
      REFERENCE: "${SPACE}",
      MULTILINE: "first  \nsecond"
    });
  });

  it("round-trips account values without trimming or interpreting them", () => {
    const variables = { PATH: 'C:\\jobs\\new "folder"', TEXT: " \tfirst\nsecond\r ", EMPTY: "" };
    expect(parseAccountTemplateVariablesEnv(formatAccountTemplateVariablesEnv(variables))).toEqual(variables);
  });

  it.each([
    ["# comment\nMISSING", "assignment"],
    ["# comment\nsubmitUser=override", "name"],
    ["BUCKET=test\nBUCKET=prod", "duplicate"],
    ['BUCKET=test\nBAD="incomplete', "quote"]
  ])("reports a malformed entry on the correct line", (text, reason) => {
    expect(() => parseAccountTemplateVariablesEnv(text)).toThrow(expect.objectContaining({ line: 2, reason }));
  });
});
