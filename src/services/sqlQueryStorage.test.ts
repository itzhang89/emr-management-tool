import { beforeEach, describe, expect, it, vi } from "vitest";
import { addSqlHistory, readSqlFavorites, readSqlHistory, addSqlFavorite, MAX_SQL_HISTORY } from "./sqlQueryStorage";

describe("sqlQueryStorage", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "test-id" });
    window.localStorage.clear();
  });

  it("stores up to 20 unique history entries", () => {
    for (let index = 0; index < MAX_SQL_HISTORY + 3; index += 1) {
      addSqlHistory("account-1", `SELECT ${index};`);
    }
    expect(readSqlHistory("account-1")).toHaveLength(MAX_SQL_HISTORY);
    expect(readSqlHistory("account-1")[0]?.sql).toBe(`SELECT ${MAX_SQL_HISTORY + 2};`);
  });

  it("dedupes history by sql text", () => {
    addSqlHistory("account-1", "SELECT 1;");
    addSqlHistory("account-1", "SELECT 2;");
    addSqlHistory("account-1", "SELECT 1;");
    expect(readSqlHistory("account-1").map((entry) => entry.sql)).toEqual(["SELECT 1;", "SELECT 2;"]);
  });

  it("stores favorites by account", () => {
    addSqlFavorite("account-1", "Daily report", "SELECT * FROM reports;");
    expect(readSqlFavorites("account-1")[0]?.name).toBe("Daily report");
  });
});
