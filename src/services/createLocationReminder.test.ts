import { describe, expect, it } from "vitest";
import {
  createLocationReminderKind,
  createStatementMissingLocation
} from "./createLocationReminder";

describe("createLocationReminder", () => {
  it("detects create database without location", () => {
    expect(createStatementMissingLocation("CREATE DATABASE IF NOT EXISTS demo COMMENT 'x';")).toBe(true);
    expect(createLocationReminderKind("CREATE SCHEMA demo")).toBe("database");
  });

  it("allows create database with location", () => {
    expect(
      createStatementMissingLocation(
        "CREATE DATABASE IF NOT EXISTS demo COMMENT 'x' LOCATION 's3://bucket/demo.db/'"
      )
    ).toBe(false);
  });

  it("detects create table without location", () => {
    expect(
      createStatementMissingLocation("CREATE EXTERNAL TABLE demo (id string) STORED AS PARQUET")
    ).toBe(true);
    expect(createLocationReminderKind("CREATE TABLE demo (id string)")).toBe("table");
  });

  it("skips ctas without location", () => {
    expect(createStatementMissingLocation("CREATE TABLE demo AS SELECT 1")).toBe(false);
  });

  it("ignores non-create statements", () => {
    expect(createStatementMissingLocation("SELECT 1")).toBe(false);
    expect(createLocationReminderKind("DROP TABLE demo")).toBeUndefined();
  });
});
