import { describe, expect, it } from "vitest";
import {
  defaultSecretKvPairs,
  firstLevelSecretFields,
  pairsFromSecretJson,
  pairsToSecretJson
} from "./SecretsPage";

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

describe("pairsToSecretJson / pairsFromSecretJson", () => {
  it("builds a JSON object and keeps port numeric", () => {
    const json = pairsToSecretJson([
      { id: "1", key: "username", value: "alice" },
      { id: "2", key: "port", value: "3306" },
      { id: "3", key: "  ", value: "skip" },
      { id: "4", key: "password", value: "x" }
    ]);
    expect(JSON.parse(json)).toEqual({
      username: "alice",
      port: 3306,
      password: "x"
    });
  });

  it("round-trips object fields into editable pairs", () => {
    const pairs = pairsFromSecretJson(
      JSON.stringify({ username: "bob", host: "db.example", port: 5432 })
    );
    expect(pairs.map((pair) => ({ key: pair.key, value: pair.value }))).toEqual([
      { key: "username", value: "bob" },
      { key: "host", value: "db.example" },
      { key: "port", value: "5432" }
    ]);
  });

  it("starts create with the default credential keys", () => {
    expect(defaultSecretKvPairs().map((pair) => pair.key)).toEqual([
      "username",
      "password",
      "host",
      "port",
      "database"
    ]);
  });
});
