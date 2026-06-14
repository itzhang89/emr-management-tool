import { describe, expect, it } from "vitest";
import { parseDateValue } from "@/services/dateFormat";

describe("dateFormat", () => {
  it("parses default datetime display values without relying on browser Date parsing", () => {
    const parsed = parseDateValue("2026-06-14 10:15:30");

    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(5);
    expect(parsed?.getDate()).toBe(14);
    expect(parsed?.getHours()).toBe(10);
    expect(parsed?.getMinutes()).toBe(15);
    expect(parsed?.getSeconds()).toBe(30);
  });
});
