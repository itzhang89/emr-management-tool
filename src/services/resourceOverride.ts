import type { ResolvedJobPayload, SparkResourceConfig } from "@/types/domain";

const RESOURCE_KEYS = [
  "spark.driver.cores",
  "spark.driver.memory",
  "spark.executor.cores",
  "spark.executor.memory",
  "spark.executor.instances"
] as const;

export function applyResourceOverride(
  payload: ResolvedJobPayload,
  resources: SparkResourceConfig
): ResolvedJobPayload {
  const next: ResolvedJobPayload = JSON.parse(JSON.stringify(payload)) as ResolvedJobPayload;
  const sparkDriver = next.jobDriver.sparkSubmitJobDriver;
  sparkDriver.sparkSubmitParameters = rewriteSparkSubmitParameters(
    sparkDriver.sparkSubmitParameters ?? "",
    resources
  );
  next.configurationOverrides = upsertSparkDefaults(
    next.configurationOverrides,
    resources
  );
  return next;
}

function rewriteSparkSubmitParameters(parameters: string, resources: SparkResourceConfig) {
  const resourceMap = resourcePropertyMap(resources);
  let next = parameters;
  for (const key of RESOURCE_KEYS) {
    const pattern = new RegExp(`--conf\\s+${escapeRegExp(key)}=\\S+`, "g");
    next = next.replace(pattern, "");
  }
  next = next.replace(/\s+/g, " ").trim();
  const confFlags = Object.entries(resourceMap).map(([key, value]) => `--conf ${key}=${value}`);
  return [next, ...confFlags].filter(Boolean).join(" ").trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertSparkDefaults(
  overrides: ResolvedJobPayload["configurationOverrides"],
  resources: SparkResourceConfig
) {
  const resourceMap = resourcePropertyMap(resources);
  const base = overrides ? JSON.parse(JSON.stringify(overrides)) : {};
  const applicationConfiguration = Array.isArray(base.applicationConfiguration)
    ? [...base.applicationConfiguration]
    : [];
  const index = applicationConfiguration.findIndex(
    (item) => item && typeof item === "object" && (item as { classification?: string }).classification === "spark-defaults"
  );
  const sparkDefaults = {
    classification: "spark-defaults",
    properties: { ...resourceMap }
  };

  if (index >= 0) {
    const existing = applicationConfiguration[index] as { properties?: Record<string, string> };
    applicationConfiguration[index] = {
      ...sparkDefaults,
      properties: {
        ...(existing.properties ?? {}),
        ...resourceMap
      }
    };
  } else {
    applicationConfiguration.push(sparkDefaults);
  }

  return {
    ...base,
    applicationConfiguration
  };
}

function resourcePropertyMap(resources: SparkResourceConfig) {
  return {
    "spark.driver.cores": String(resources.driverCores),
    "spark.driver.memory": resources.driverMemory,
    "spark.executor.cores": String(resources.executorCores),
    "spark.executor.memory": resources.executorMemory,
    "spark.executor.instances": String(resources.executorInstances)
  };
}
