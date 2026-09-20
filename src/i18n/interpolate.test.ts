import { describe, expect, it } from "vitest";
import { interpolate } from "./interpolate";

describe("interpolate", () => {
  it("returns the template untouched when no vars are supplied", () => {
    expect(interpolate("Go to {label}")).toBe("Go to {label}");
  });

  it("substitutes named placeholders", () => {
    expect(interpolate("Go to {label}", { label: "Logs" })).toBe("Go to Logs");
  });

  it("substitutes every occurrence and accepts numbers", () => {
    expect(interpolate("{count} of {count} ({total})", { count: 3, total: 9 })).toBe("3 of 3 (9)");
  });

  it("leaves an unknown placeholder intact so a missing variable is visible", () => {
    expect(interpolate("Hi {name}", { other: "x" })).toBe("Hi {name}");
  });

  it("ignores variables that the template never references", () => {
    expect(interpolate("Saved", { unused: "x" })).toBe("Saved");
  });
});
