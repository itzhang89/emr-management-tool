import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  ApplicationTemplate,
  AppError,
  AwsAccount,
  AwsAccountCredentialsInput,
  AwsAccountSummary,
  AwsCommandContext,
  AwsCredentialsInput,
  AwsIdentity,
  AwsSettings,
  JobLogsResponse,
  JobLogsRequest,
  JobRunSummary,
  ListVirtualClustersRequest,
  ListVirtualClustersResponse,
  ResourceTemplate,
  S3Bucket,
  S3ObjectEntry,
  S3TextObject,
  StartJobRunRequest
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
    listAwsAccounts: () => call<AwsAccountSummary[]>("list_aws_accounts"),
    createAwsAccount: (request: AwsAccountCredentialsInput) => call<AwsAccount>("create_aws_account", request),
    setActiveAwsAccount: (request: { accountId: string }) => call<AwsAccountSummary>("set_active_aws_account", request),
    deleteAwsAccount: (request: { accountId: string }) => call("delete_aws_account", request),
    listVirtualClusters: (request: ListVirtualClustersRequest) =>
      call<ListVirtualClustersResponse>("list_virtual_clusters", request),
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
    getJobLogs: (request: JobLogsRequest) => call<JobLogsResponse>("get_job_logs", request),
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

  return demoModeUnavailable(command, args);
}

async function demoModeUnavailable<T>(command: string, _args?: Record<string, unknown>): Promise<T> {
  const error: AppError = {
    kind: "demo",
    code: "DemoModeUnavailable",
    message: `Command ${command} requires the Tauri desktop runtime. Start the app with npm run tauri -- dev.`,
    retryable: false
  };

  throw error;
}
