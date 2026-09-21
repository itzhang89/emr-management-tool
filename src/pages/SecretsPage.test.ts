import { describe, expect, it } from "vitest";
import {
  defaultSecretKvPairs,
  isCreatedBy,
  pairsFromSecretJson,
  pairsToSecretJson
} from "./SecretsPage";
import type { SecretSummary } from "@/types/domain";

function summary(tags: Array<{ key: string; value: string }>): SecretSummary {
  return { name: "mysql.sales_ro", arn: "arn:aws:secretsmanager:::secret:mysql.sales_ro", tags };
}

describe("isCreatedBy", () => {
  it("matches only the createdBy tag, not the last modifier", () => {
    const secret = summary([
      { key: "createdBy", value: "alice" },
      { key: "lastModifiedBy", value: "bob" }
    ]);
    expect(isCreatedBy(secret, "alice")).toBe(true);
    expect(isCreatedBy(secret, "bob")).toBe(false);
  });

  it("treats untagged secrets and unknown users as not mine", () => {
    expect(isCreatedBy(summary([]), "alice")).toBe(false);
    expect(isCreatedBy(summary([{ key: "createdBy", value: "alice" }]), undefined)).toBe(false);
  });

  it("ignores the legacy submitUser tag", () => {
    expect(isCreatedBy(summary([{ key: "submitUser", value: "alice" }]), "alice")).toBe(false);
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
