import { applyResourceOverride } from "@/services/resourceOverride";
import type { JobRunSummary, ResolvedJobPayload, SparkResourceConfig } from "@/types/domain";

export type StartJobPayloadJson = ResolvedJobPayload;

export function isSparkSubmitDescribe(job: JobRunSummary): boolean {
  return job.describeDetails?.jobDriver?.type === "sparkSubmit";
}

export function describeJobToStartJobPayload(job: JobRunSummary): StartJobPayloadJson {
  const details = job.describeDetails;
  if (!details) {
    throw new Error("Job describe details are required.");
  }
  const driver = details.jobDriver;
  if (!driver || driver.type !== "sparkSubmit") {
    throw new Error("Only sparkSubmit jobs can be converted to a StartJobRun payload.");
  }
  if (!details.executionRoleArn?.trim() || !details.releaseLabel?.trim()) {
    // Still build what we can; missing fields are allowed in the object and blocked at submit validation.
  }

  const payload: StartJobPayloadJson = {
    name: job.name,
    virtualClusterId: job.virtualClusterId,
    executionRoleArn: details.executionRoleArn ?? "",
    releaseLabel: details.releaseLabel ?? "",
    jobDriver: {
      sparkSubmitJobDriver: {
        entryPoint: driver.entryPoint ?? "",
        entryPointArguments: driver.entryPointArguments ?? [],
        sparkSubmitParameters: driver.sparkSubmitParameters ?? ""
      }
    }
  };

  if (details.configurationOverrides) {
    payload.configurationOverrides = details.configurationOverrides;
  }

  return payload;
}

export function parseSourceJobPayload(
  text: string
): { ok: true; payload: StartJobPayloadJson } | { ok: false; error: string } {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "Source payload must be a JSON object." };
    }
    return { ok: true, payload: value as StartJobPayloadJson };
  } catch {
    return { ok: false, error: "Invalid JSON." };
  }
}

export function formatSourceJobPayload(payload: StartJobPayloadJson): string {
  return JSON.stringify(payload, null, 2);
}

export function applyRuntimeToSourcePayload(
  payload: StartJobPayloadJson,
  virtualClusterId: string,
  resources: SparkResourceConfig
): StartJobPayloadJson {
  const withCluster = { ...payload, virtualClusterId };
  return applyResourceOverride(withCluster, resources);
}
