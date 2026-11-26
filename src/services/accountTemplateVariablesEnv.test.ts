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
      'HASH="a#b=c"  # Keep # in the value',
      "EMPTY=  # Blank on purpose",
      "PLAIN=plain  # Unquoted description",
      "REFERENCE=\${SPACE}",
      "MULTILINE='first  ",
      "second'  # Multiline value"
    ].join("\r\n");
    expect(parseAccountTemplateVariablesEnv(text)).toEqual({
      SPACE: { value: " leading and trailing ", description: "comment" },
      HASH: { value: "a#b=c", description: "Keep # in the value" },
      EMPTY: { value: "", description: "Blank on purpose" },
      PLAIN: { value: "plain", description: "Unquoted description" },
      REFERENCE: { value: "${SPACE}" },
      MULTILINE: { value: "first  \nsecond", description: "Multiline value" }
    });
  });

  it("round-trips account values without trimming or interpreting them", () => {
    const variables = {
      PATH: { value: 'C:\\jobs\\new "folder"', description: "Windows # path" },
      TEXT: { value: " \tfirst\nsecond\r ", description: "Escaped value" },
      EMPTY: { value: "" }
    };
    expect(parseAccountTemplateVariablesEnv(formatAccountTemplateVariablesEnv(variables))).toEqual(variables);
  });

  it.each([
    ["# comment\nMISSING", "assignment"],
    ["# comment\nsubmitUser=override", "name"],
    ["# comment\nAWS_USERNAME=override", "name"],
    ["# comment\nAWS_ACCOUNT_ID=override", "name"],
    ["# comment\nAWS_REGION=override", "name"],
    ["BUCKET=test\nBUCKET=prod", "duplicate"],
    ['BUCKET=test\nBAD="incomplete', "quote"]
  ])("reports a malformed entry on the correct line", (text, reason) => {
    expect(() => parseAccountTemplateVariablesEnv(text)).toThrow(expect.objectContaining({ line: 2, reason }));
  });
});
