import { describe, it, expect, beforeAll } from "vitest";
import { sanitizeLogText } from "../src/sanitize/index";

describe("sanitizeLogText", () => {
  it("should redact 12-digit AWS account IDs", () => {
    const text = "Running on account 123456789012 with bucket my-bucket";
    const result = sanitizeLogText(text);
    expect(result).toContain("[AWS_ACCOUNT_ID]");
    expect(result).not.toContain("123456789012");
  });

  it("should redact S3 bucket names", () => {
    const text = "Uploading to s3://my-data-lake-us-east-1/jobs/abc123/";
    const result = sanitizeLogText(text);
    expect(result).toContain("s3://[S3_BUCKET]/");
    expect(result).not.toContain("my-data-lake-us-east-1");
  });

  it("should redact ARNs", () => {
    const text = "Assuming role arn:aws:iam::123456789012:role/EMR_ExecutionRole";
    const result = sanitizeLogText(text);
    expect(result).toContain("[ARN]");
    expect(result).not.toContain("123456789012");
    expect(result).not.toContain("EMR_ExecutionRole");
  });

  it("should redact IP addresses", () => {
    const text = "Connecting to 10.0.1.45:8080 and 192.168.1.1:5432";
    const result = sanitizeLogText(text);
    expect(result).toContain("[IP_ADDRESS]");
    expect(result).not.toContain("10.0.1.45");
    expect(result).not.toContain("192.168.1.1");
  });

  it("should redact EC2 internal hostnames", () => {
    const text = "Connecting to ip-10-0-1-45.ec2.internal:8080";
    const result = sanitizeLogText(text);
    expect(result).toContain("[HOSTNAME]");
    expect(result).not.toContain("ip-10-0-1-45.ec2.internal");
  });

  it("should redact FQDN hostnames", () => {
    const text = "Connecting to my-cluster.us-east-1.elb.amazonaws.com:8080";
    const result = sanitizeLogText(text);
    expect(result).toContain("[HOSTNAME]");
    expect(result).not.toContain("my-cluster.us-east-1.elb.amazonaws.com");
  });

  it("should not affect normal log messages", () => {
    const text = "INFO TaskSetManager: Starting task 1 of 10";
    const result = sanitizeLogText(text);
    expect(result).toBe(text);
  });

  it("should handle multiple redactions in one line", () => {
    const text = "Running on 123456789012 at 10.0.1.45, using arn:aws:iam::123456789012:role/R1 and s3://my-bucket/jobs/abc";
    const result = sanitizeLogText(text);
    expect(result).toContain("[AWS_ACCOUNT_ID]");
    expect(result).toContain("[IP_ADDRESS]");
    expect(result).toContain("[ARN]");
    expect(result).toContain("s3://[S3_BUCKET]/");
  });

  it("should handle empty text", () => {
    expect(sanitizeLogText("")).toBe("");
  });

  it("should handle text with no sensitive data", () => {
    const text = "INFO MyLogger: Processing data successfully";
    const result = sanitizeLogText(text);
    expect(result).toBe(text);
  });

  it("should not false-positive on normal numbers", () => {
    const text = "INFO TaskSchedulerImpl: Starting 42 tasks with 10 stages";
    const result = sanitizeLogText(text);
    expect(result).toBe(text);
  });

  it("should handle SQL log lines", () => {
    const text = "SELECT * FROM s3://data-bucket/sales WHERE region = 'us-east-1'";
    const result = sanitizeLogText(text);
    expect(result).toContain("s3://[S3_BUCKET]/");
    expect(result).not.toContain("data-bucket");
  });

  it("should handle Spark error with mixed data", () => {
    const text = "ERROR SparkException: Job aborted: Task failed due to s3://etl-output-bucket/part-00000 and ip-10-0-1-100.ec2.internal";
    const result = sanitizeLogText(text);
    expect(result).toContain("s3://[S3_BUCKET]/");
    expect(result).not.toContain("etl-output-bucket");
    expect(result).toContain("[HOSTNAME]");
    expect(result).not.toContain("ip-10-0-1-100.ec2.internal");
  });
});