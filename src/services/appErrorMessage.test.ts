import { describe, expect, it } from "vitest";
import { formatAppError, formatS3BrowserError } from "./appErrorMessage";

describe("formatAppError", () => {
  it("returns the AWS error message when it is specific", () => {
    expect(
      formatAppError(
        {
          kind: "aws",
          code: "AccessDenied",
          service: "s3",
          message: "User is not authorized to perform: s3:ListAllMyBuckets"
        },
        "Failed."
      )
    ).toBe("User is not authorized to perform: s3:ListAllMyBuckets");
  });

  it("maps generic service errors to actionable S3 guidance", () => {
    expect(
      formatAppError(
        {
          kind: "aws",
          code: "AwsSdkError",
          service: "s3",
          message: "service error"
        },
        "Failed."
      )
    ).toBe("Failed to reach S3. Check account permissions, credentials, and region in Settings.");
  });

  it("maps access denied codes to permission guidance", () => {
    expect(
      formatAppError(
        {
          kind: "aws",
          code: "AccessDenied",
          service: "s3",
          message: "service error"
        },
        "Failed."
      )
    ).toBe(
      "Access denied for S3. Grant the required s3:* permissions to this account in IAM and verify the region in Settings."
    );
  });
});

describe("formatS3BrowserError", () => {
  it("uses bucket listing guidance when buckets fail to load", () => {
    expect(
      formatS3BrowserError(
        {
          kind: "aws",
          code: "AccessDenied",
          service: "s3",
          message: "service error"
        },
        "listBuckets"
      )
    ).toBe(
      "Access denied when listing S3 buckets. Grant s3:ListAllMyBuckets (and s3:ListBucket for specific buckets) to this account in IAM, then verify the region in Settings."
    );
  });

  it("uses object listing guidance when a bucket prefix fails to load", () => {
    expect(
      formatS3BrowserError(
        {
          kind: "aws",
          code: "AccessDenied",
          service: "s3",
          message: "service error"
        },
        "listObjects",
        "s3://logs-bucket/"
      )
    ).toBe(
      "Access denied when listing objects in s3://logs-bucket/. Grant s3:ListBucket to this account in IAM."
    );
  });
});
