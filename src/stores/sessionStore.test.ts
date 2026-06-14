import { describe, expect, it } from "vitest";
import { useSessionStore } from "./sessionStore";

describe("useSessionStore", () => {
  it("tracks selected region and virtual cluster", () => {
    useSessionStore.getState().setRegion("us-west-2");
    useSessionStore.getState().setSelectedVirtualClusterId("vc-prod");

    expect(useSessionStore.getState().region).toBe("us-west-2");
    expect(useSessionStore.getState().selectedVirtualClusterId).toBe("vc-prod");
  });

  it("resets account-scoped session selections without changing global region", () => {
    const request = {
      name: "job",
      virtualClusterId: "vc-prod",
      executionRoleArn: "arn",
      releaseLabel: "emr",
      application: { type: "jar" as const, jarPath: "s3://bucket/app.jar", mainClass: "Main" },
      arguments: [],
      resources: {
        driverCores: 1,
        driverMemory: "1G",
        executorCores: 1,
        executorMemory: "1G",
        executorInstances: 1
      },
      sparkConfig: {},
      jobDriver: {
        sparkSubmitJobDriver: {
          entryPoint: "s3://bucket/app.jar",
          entryPointArguments: [],
          sparkSubmitParameters: "--class Main"
        }
      }
    };

    useSessionStore.setState({
      region: "us-west-2",
      selectedVirtualClusterId: "vc-prod",
      selectedJobId: "job-1",
      selectedJobVirtualClusterId: "vc-prod",
      selectedS3Bucket: "logs",
      selectedS3Prefix: "jobs/job-1/",
      clonedJobRequest: request
    });

    useSessionStore.getState().resetAccountScopedSession();

    expect(useSessionStore.getState().region).toBe("us-west-2");
    expect(useSessionStore.getState().selectedVirtualClusterId).toBeUndefined();
    expect(useSessionStore.getState().selectedJobId).toBeUndefined();
    expect(useSessionStore.getState().selectedJobVirtualClusterId).toBeUndefined();
    expect(useSessionStore.getState().selectedS3Bucket).toBeUndefined();
    expect(useSessionStore.getState().selectedS3Prefix).toBeUndefined();
    expect(useSessionStore.getState().clonedJobRequest).toBeUndefined();
  });
});
