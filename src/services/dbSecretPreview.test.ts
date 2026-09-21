import { describe, expect, it } from "vitest";
import { providedSecretFields, readDbSecretPreview, secretFieldValue } from "./dbSecretPreview";

describe("readDbSecretPreview", () => {
  it("lists all five fields when the secret carries them", () => {
    const preview = readDbSecretPreview(
      JSON.stringify({
        username: "bi",
        password: "s3cret",
        host: "db.internal",
        port: 3307,
        database: "sales"
      })
    );
    expect(preview.status).toBe("ok");
    expect(providedSecretFields(preview)).toEqual(
      new Set(["host", "port", "database", "username", "password"])
    );
    expect(secretFieldValue(preview, "host")).toBe("db.internal");
    expect(secretFieldValue(preview, "port")).toBe("3307");
  });

  it("never carries the password out of the secret", () => {
    const preview = readDbSecretPreview(JSON.stringify({ password: "s3cret" }));
    expect(providedSecretFields(preview).has("password")).toBe(true);
    expect(secretFieldValue(preview, "password")).toBeUndefined();
    // Nothing anywhere in the preview holds it.
    expect(JSON.stringify(preview)).not.toContain("s3cret");
  });

  it("marks only the keys the secret actually supplies", () => {
    const preview = readDbSecretPreview(JSON.stringify({ password: "only", host: "db.internal" }));
    expect(providedSecretFields(preview)).toEqual(new Set(["host", "password"]));
    expect(secretFieldValue(preview, "username")).toBeUndefined();
  });

  it("treats blank values as absent, the way the overlay skips them", () => {
    const preview = readDbSecretPreview(
      JSON.stringify({ host: "  ", username: "", database: "sales" })
    );
    expect(providedSecretFields(preview)).toEqual(new Set(["database"]));
  });

  it("rejects a port the overlay would refuse", () => {
    expect(providedSecretFields(readDbSecretPreview(JSON.stringify({ port: 0 }))).has("port")).toBe(
      false
    );
    expect(
      providedSecretFields(readDbSecretPreview(JSON.stringify({ port: 70000 }))).has("port")
    ).toBe(false);
    expect(
      providedSecretFields(readDbSecretPreview(JSON.stringify({ port: "not-a-port" }))).has("port")
    ).toBe(false);
  });

  it("reads a non-object secret as unreadable", () => {
    expect(readDbSecretPreview("not-json").status).toBe("unreadable");
    expect(readDbSecretPreview('"plain"').status).toBe("unreadable");
    expect(readDbSecretPreview("[1,2]").status).toBe("unreadable");
    expect(providedSecretFields(readDbSecretPreview("not-json")).size).toBe(0);
    expect(secretFieldValue(readDbSecretPreview("not-json"), "host")).toBeUndefined();
  });

  it("reports an empty object as supplying nothing", () => {
    const preview = readDbSecretPreview("{}");
    expect(preview.status).toBe("ok");
    expect(providedSecretFields(preview).size).toBe(0);
  });
});
