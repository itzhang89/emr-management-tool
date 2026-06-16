import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  ApplicationTemplate,
  AppError,
  AwsAccount,
  AwsAccountCredentialsInput,
  AwsAccountSummary,
  AwsCliProfileSummary,
  AwsCommandContext,
  AwsCredentialsInput,
  AwsIdentity,
  AwsSettings,
  ImportAwsCliProfileRequest,
  JobLogStreamsRequest,
  JobLogStreamsResponse,
  JobLogsResponse,
  JobLogsRequest,
  JobConfigTemplate,
  JobRunSummary,
  ListVirtualClustersRequest,
  ListVirtualClustersResponse,
  ResourceTemplate,
  S3Bucket,
  S3JobLogObjectsRequest,
  S3JobLogObjectsResponse,
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
    listAwsCliProfiles: () => call<AwsCliProfileSummary[]>("list_aws_cli_profiles"),
    importAwsCliProfile: (request: ImportAwsCliProfileRequest) => call<AwsAccount>("import_aws_cli_profile", request),
    listVirtualClusters: (request: ListVirtualClustersRequest) =>
      call<ListVirtualClustersResponse>("list_virtual_clusters", request),
    listJobRuns: (request: { accountId?: string; virtualClusterId?: string; keyword?: string }) =>
      call<JobRunSummary[]>("list_job_runs", request),
    describeJobRun: (request: { accountId?: string; id: string; virtualClusterId: string }) =>
      call<JobRunSummary>("describe_job_run", request),
    startJobRun: (request: StartJobRunRequest) => call<JobRunSummary>("start_job_run", request),
    cancelJobRun: (request: { accountId?: string; id: string; virtualClusterId: string }) =>
      call<JobRunSummary>("cancel_job_run", request),
    listTemplates: () =>
      call<{ applicationTemplates: ApplicationTemplate[]; resourceTemplates: ResourceTemplate[] }>("list_templates"),
    createTemplate: (request: ApplicationTemplate | ResourceTemplate) => call("create_template", request),
    updateTemplate: (request: ApplicationTemplate | ResourceTemplate) => call("update_template", request),
    deleteTemplate: (request: { id: string; type: "application" | "resource" }) => call("delete_template", request),
    duplicateTemplate: (request: { id: string; type: "application" | "resource" }) => call("duplicate_template", request),
    listJobConfigTemplates: () =>
      call<{ jobConfigTemplates: JobConfigTemplate[] }>("list_job_config_templates"),
    createJobConfigTemplate: (request: JobConfigTemplate) =>
      call<{ jobConfigTemplates: JobConfigTemplate[] }>("create_job_config_template", request),
    updateJobConfigTemplate: (request: JobConfigTemplate) =>
      call<{ jobConfigTemplates: JobConfigTemplate[] }>("update_job_config_template", request),
    deleteJobConfigTemplate: (request: { id: string }) =>
      call<{ jobConfigTemplates: JobConfigTemplate[] }>("delete_job_config_template", request),
    duplicateJobConfigTemplate: (request: { id: string }) =>
      call<{ jobConfigTemplates: JobConfigTemplate[] }>("duplicate_job_config_template", request),
    getSubmitUser: () => call<string>("get_submit_user"),
    listJobLogStreams: (request: JobLogStreamsRequest) => call<JobLogStreamsResponse>("list_job_log_streams", request),
    getJobLogs: (request: JobLogsRequest) => call<JobLogsResponse>("get_job_logs", request),
    listS3Buckets: (request: { accountId?: string } = {}) => call<S3Bucket[]>("list_s3_buckets", request),
    listS3Objects: (request: { accountId?: string; bucket: string; prefix?: string }) =>
      call<S3ObjectEntry[]>("list_s3_objects", request),
    listS3JobLogObjects: (request: S3JobLogObjectsRequest) => call<S3JobLogObjectsResponse>("list_s3_job_log_objects", request),
    getS3JobLogObject: (request: { accountId?: string; bucket: string; key: string }) =>
      call<S3TextObject>("get_s3_job_log_object", request),
    getS3TextObject: (request: { accountId?: string; bucket: string; key: string }) =>
      call<S3TextObject>("get_s3_text_object", request),
    putS3TextObject: (request: S3TextObject) => call<S3TextObject>("put_s3_text_object", request),
    uploadS3Object: (request: { accountId?: string; bucket: string; key: string; content: string }) =>
      call<S3ObjectEntry>("upload_s3_object", request),
    downloadS3Object: (request: { accountId?: string; bucket: string; key: string }) =>
      call<S3TextObject>("download_s3_object", request),
    downloadS3ObjectToDisk: (request: { bucket: string; key: string }) =>
      call<string | undefined>("download_s3_object_to_disk", request),
    uploadS3ObjectFromDisk: (request: { bucket: string; prefix?: string }) =>
      call<S3ObjectEntry | undefined>("upload_s3_object_from_disk", request),
    renameS3Object: (request: { accountId?: string; bucket: string; sourceKey: string; destinationKey: string }) =>
      call<S3ObjectEntry>("rename_s3_object", request),
    saveTextFile: (request: { suggestedName: string; content: string }) =>
      call<string | undefined>("save_text_file", request),
    openTextFile: () => call<string | undefined>("open_text_file"),
    deleteS3Object: (request: { accountId?: string; bucket: string; key: string }) =>
      call("delete_s3_object", request)
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
