import { describe, expect, it } from "vitest";
import {
  buildJobS3LogPrefix,
  defaultCloudWatchDestination,
  parseS3Uri,
  resolveJobLogDestinations
} from "./jobLogDestinations";
import type { JobRunSummary } from "@/types/domain";

describe("jobLogDestinations", () => {
  it("parses s3 uris with and without key prefixes", () => {
    expect(parseS3Uri("s3://logs-bucket/emr/")).toEqual({ bucket: "logs-bucket", prefix: "emr/" });
    expect(parseS3Uri("s3://logs-bucket")).toEqual({ bucket: "logs-bucket", prefix: "" });
  });

  it("builds the EMR on EKS job log prefix under the configured log uri", () => {
    expect(buildJobS3LogPrefix("s3://logs-bucket/emr/", "vc-1", "job-running")).toEqual({
      bucket: "logs-bucket",
      prefix: "emr/vc-1/jobs/job-running/"
    });
  });

  it("resolves cloudwatch and s3 destinations from describe monitoring configuration", () => {
    const job = makeJob({
      describeDetails: {
        configurationOverrides: {
          monitoringConfiguration: {
            cloudWatchMonitoringConfiguration: {
              logGroupName: "/aws/emr-containers/jobs/custom",
              logStreamNamePrefix: "custom-prefix"
            },
            s3MonitoringConfiguration: {
              logUri: "s3://logs-bucket/emr/"
            }
          }
        }
      }
    });

    expect(resolveJobLogDestinations(job)).toEqual({
      cloudWatch: {
        logGroupName: "/aws/emr-containers/jobs/custom",
        streamNamePrefix: "custom-prefix"
      },
      s3: {
        bucket: "logs-bucket",
        prefix: "emr/vc-1/jobs/job-running/"
      }
    });
  });

  it("returns only the configured destination when monitoring is partial", () => {
    const cloudWatchOnly = makeJob({
      describeDetails: {
        configurationOverrides: {
          monitoringConfiguration: {
            cloudWatchMonitoringConfiguration: {
              logGroupName: "/aws/emr-containers/jobs/custom"
            }
          }
        }
      }
    });
    const s3Only = makeJob({
      describeDetails: {
        configurationOverrides: {
          monitoringConfiguration: {
            s3MonitoringConfiguration: {
              logUri: "s3://logs-bucket"
            }
          }
        }
      }
    });

    expect(resolveJobLogDestinations(cloudWatchOnly)).toEqual({
      cloudWatch: {
        logGroupName: "/aws/emr-containers/jobs/custom",
        streamNamePrefix: undefined
      }
    });
    expect(resolveJobLogDestinations(s3Only)).toEqual({
      s3: {
        bucket: "logs-bucket",
        prefix: "vc-1/jobs/job-running/"
      }
    });
  });

  it("falls back to the default cloudwatch group naming convention", () => {
    expect(defaultCloudWatchDestination({ id: "job-running" })).toEqual({
      logGroupName: "/aws/emr-containers/jobs/job-running",
      streamNamePrefix: "job-running"
    });
  });
});

function makeJob(overrides: Partial<JobRunSummary>): JobRunSummary {
  return {
    id: "job-running",
    name: "running-etl",
    state: "RUNNING",
    virtualClusterId: "vc-1",
    createdAt: "2026-06-10T00:00:00Z",
    ...overrides
  };
}
