import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  ApplicationTemplate,
  AwsCredentialsInput,
  AwsIdentity,
  AwsSettings,
  JobLogsResponse,
  JobRunSummary,
  ResourceTemplate,
  S3Bucket,
  S3ObjectEntry,
  S3TextObject,
  StartJobRunRequest,
  VirtualCluster
} from "@/types/domain";

export type InvokeFunction = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function createTauriClient(invoke: InvokeFunction = defaultInvoke) {
  const call = <T>(command: string, request?: unknown) =>
    invoke<T>(command, request === undefined ? undefined : { request: request as Record<string, unknown> });

  return {
    testAwsCredentials: (request: AwsCredentialsInput) => call<AwsIdentity>("test_aws_credentials", request),
    saveAwsCredentials: (request: AwsCredentialsInput) => call<AwsSettings>("save_aws_credentials", request),
    getAwsSettings: () => call<AwsSettings>("get_aws_settings"),
    clearAwsCredentials: () => call<AwsSettings>("clear_aws_credentials"),
    listVirtualClusters: (request: { region: string }) => call<VirtualCluster[]>("list_virtual_clusters", request),
    listJobRuns: (request: { virtualClusterId?: string }) => call<JobRunSummary[]>("list_job_runs", request),
    describeJobRun: (request: { id: string; virtualClusterId: string }) => call<JobRunSummary>("describe_job_run", request),
    startJobRun: (request: StartJobRunRequest) => call<JobRunSummary>("start_job_run", request),
    cancelJobRun: (request: { id: string; virtualClusterId: string }) => call<JobRunSummary>("cancel_job_run", request),
    listTemplates: () =>
      call<{ applicationTemplates: ApplicationTemplate[]; resourceTemplates: ResourceTemplate[] }>("list_templates"),
    createTemplate: (request: ApplicationTemplate | ResourceTemplate) => call("create_template", request),
    updateTemplate: (request: ApplicationTemplate | ResourceTemplate) => call("update_template", request),
    deleteTemplate: (request: { id: string; type: "application" | "resource" }) => call("delete_template", request),
    duplicateTemplate: (request: { id: string; type: "application" | "resource" }) => call("duplicate_template", request),
    getJobLogs: (request: { jobId: string; nextForwardToken?: string }) => call<JobLogsResponse>("get_job_logs", request),
    listS3Buckets: () => call<S3Bucket[]>("list_s3_buckets"),
    listS3Objects: (request: { bucket: string; prefix?: string }) => call<S3ObjectEntry[]>("list_s3_objects", request),
    getS3TextObject: (request: { bucket: string; key: string }) => call<S3TextObject>("get_s3_text_object", request),
    putS3TextObject: (request: S3TextObject) => call<S3TextObject>("put_s3_text_object", request),
    uploadS3Object: (request: { bucket: string; key: string; content: string }) => call<S3ObjectEntry>("upload_s3_object", request),
    downloadS3Object: (request: { bucket: string; key: string }) => call<S3TextObject>("download_s3_object", request),
    deleteS3Object: (request: { bucket: string; key: string }) => call("delete_s3_object", request)
  };
}

export const tauriClient = createTauriClient();

async function defaultInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return tauriInvoke<T>(command, args);
  }

  return mockInvoke<T>(command, args);
}

async function mockInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const request = args?.request as Record<string, unknown> | undefined;

  const fixtures: Record<string, unknown> = {
    get_aws_settings: { region: "us-east-1", hasSavedCredentials: false },
    list_virtual_clusters: [
      {
        id: "vc-prod",
        name: "emr-prod",
        state: "RUNNING",
        namespace: "analytics",
        eksClusterName: "eks-prod",
        createdAt: "2026-04-16T00:00:00Z"
      },
      {
        id: "vc-dev",
        name: "emr-dev",
        state: "RUNNING",
        namespace: "sandbox",
        eksClusterName: "eks-dev",
        createdAt: "2026-05-02T00:00:00Z"
      }
    ],
    list_job_runs: [],
    list_templates: { applicationTemplates: [], resourceTemplates: [] },
    list_s3_buckets: [{ name: "analytics-bucket", createdAt: "2026-01-01T00:00:00Z" }],
    list_s3_objects: [
      {
        bucket: request?.bucket ?? "analytics-bucket",
        key: "scripts/etl.sql",
        kind: "file",
        size: 2048,
        lastModified: "2026-06-09T00:00:00Z",
        etag: "\"local-preview\""
      },
      {
        bucket: request?.bucket ?? "analytics-bucket",
        key: "jars/app.jar",
        kind: "file",
        size: 24_000_000,
        lastModified: "2026-06-09T00:00:00Z",
        etag: "\"local-preview\""
      }
    ],
    get_s3_text_object: {
      bucket: request?.bucket ?? "analytics-bucket",
      key: request?.key ?? "scripts/etl.sql",
      content: "select *\nfrom source.events\nwhere dt = '${date}';\n",
      etag: "\"local-preview\"",
      contentType: "text/plain",
      lastModified: "2026-06-09T00:00:00Z"
    },
    get_job_logs: { jobId: request?.jobId ?? "job-preview", entries: [] }
  };

  if (command === "start_job_run") {
    return {
      id: `job-${Date.now()}`,
      name: request?.name ?? "preview-job",
      state: "SUBMITTED",
      virtualClusterId: request?.virtualClusterId ?? "vc-preview",
      createdAt: new Date().toISOString()
    } as T;
  }

  if (command === "put_s3_text_object") {
    return { ...request, etag: `"${Date.now()}"`, lastModified: new Date().toISOString() } as T;
  }

  return fixtures[command] as T;
}
