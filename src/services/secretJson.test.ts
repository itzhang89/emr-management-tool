import { describe, expect, it } from "vitest";
import { firstLevelSecretFields } from "./secretJson";

describe("firstLevelSecretFields", () => {
  it("lists only top-level object keys and stringifies nested values", () => {
    const result = firstLevelSecretFields(
      JSON.stringify({
        username: "alice",
        password: "s3cret",
        port: 3306,
        nested: { a: 1 }
      })
    );
    expect(result.kind).toBe("object");
    if (result.kind !== "object") return;
    expect(result.fields).toEqual([
      { key: "username", value: "alice" },
      { key: "password", value: "s3cret" },
      { key: "port", value: "3306" },
      { key: "nested", value: '{"a":1}' }
    ]);
  });

  it("falls back to raw for non-object JSON or invalid text", () => {
    expect(firstLevelSecretFields('"plain"')).toEqual({ kind: "raw", value: '"plain"' });
    expect(firstLevelSecretFields("not-json")).toEqual({ kind: "raw", value: "not-json" });
    expect(firstLevelSecretFields("[1,2]")).toEqual({ kind: "raw", value: "[1,2]" });
  });
});
