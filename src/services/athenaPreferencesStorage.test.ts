import { afterEach, describe, expect, it } from "vitest";
import {
  mergeAthenaPreferences,
  readAthenaPreferences,
  writeAthenaPreferences
} from "./athenaPreferencesStorage";

describe("athenaPreferencesStorage", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("stores output path per account", () => {
    mergeAthenaPreferences("aws-profile-a", {
      outputBasePath: "s3://bucket-a/athena/"
    });
    mergeAthenaPreferences("aws-profile-b", {
      outputBasePath: "s3://bucket-b/athena/"
    });

    expect(readAthenaPreferences("aws-profile-a").outputBasePath).toBe("s3://bucket-a/athena/");
    expect(readAthenaPreferences("aws-profile-b").outputBasePath).toBe("s3://bucket-b/athena/");
  });

  it("merges partial updates without dropping other fields", () => {
    writeAthenaPreferences("aws-profile-a", {
      outputBasePath: "s3://bucket/athena/",
      appendSubmitUser: true,
      lastWorkgroup: "primary"
    });

    mergeAthenaPreferences("aws-profile-a", { lastWorkgroup: "analytics" });

    const preferences = readAthenaPreferences("aws-profile-a");
    expect(preferences.outputBasePath).toBe("s3://bucket/athena/");
    expect(preferences.appendSubmitUser).toBe(true);
    expect(preferences.lastWorkgroup).toBe("analytics");
  });
});
