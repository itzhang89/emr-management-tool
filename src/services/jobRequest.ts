import type { StartJobRunRequest, SubmitJobFormValues } from "@/types/domain";

export function buildStartJobRunRequest(values: SubmitJobFormValues): StartJobRunRequest {
  const sparkSubmitParameters = [
    `--class ${values.application.mainClass}`,
    ...resourceParameters(values.resources),
    ...sparkConfigParameters(values.sparkConfig)
  ].join(" ");

  return {
    ...values,
    jobDriver: {
      sparkSubmitJobDriver: {
        entryPoint: values.application.jarPath,
        entryPointArguments: values.arguments.filter((argument) => argument.trim().length > 0),
        sparkSubmitParameters
      }
    }
  };
}

function resourceParameters(resources: SubmitJobFormValues["resources"]) {
  return [
    ["spark.driver.cores", String(resources.driverCores)],
    ["spark.driver.memory", resources.driverMemory],
    ["spark.executor.cores", String(resources.executorCores)],
    ["spark.executor.memory", resources.executorMemory],
    ["spark.executor.instances", String(resources.executorInstances)]
  ].map(([key, value]) => `--conf ${key}=${value}`);
}

function sparkConfigParameters(config: Record<string, string>) {
  return Object.entries(config)
    .filter(([key, value]) => key.trim().length > 0 && value.trim().length > 0)
    .map(([key, value]) => `--conf ${key.trim()}=${value.trim()}`);
}
