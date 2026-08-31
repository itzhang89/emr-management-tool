import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  ApplicationTemplate,
  AppError,
  AwsAccount,
  AwsAccountCredentialsInput,
  AwsAccountSummary,
  AwsAccountUpdateInput,
  AwsCliProfileCredentials,
  AwsCliProfileSummary,
  TestAwsAccountRequest,
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
  S3UploadFromPathRequest,
  S3UploadPrepareResult,
  S3PrefixDeletionSummary,
  S3TextObject,
  StartJobRunRequest,
  GlueListRequest,
  GlueListDatabasesResponse,
  GlueListTablesResponse,
  GlueGetDatabaseRequest,
  GlueDatabaseDetail,
  GlueUpdateDatabaseRequest,
  GlueGetTableRequest,
  GlueTableDetail,
  GlueUpdateTableRequest,
  AthenaWorkgroup,
  StartAthenaQueryRequest,
  AthenaQueryExecution,
  AthenaQueryExecutionRequest,
  AthenaQueryResults,
  AthenaQueryResultsRequest,
  ExportAthenaQueryCsvRequest,
  PortableUpdateInfo,
  McpStatus,
  McpAuditEntry,
  AddLlmModelsRequest,
  CreateLlmEndpointRequest,
  CreateLlmProviderRequest,
  LlmEndpointTestResult,
  LlmModelCandidate,
  LlmProvider,
  UpdateLlmEndpointRequest,
  UpdateLlmModelRequest,
  UpdateLlmProviderRequest,
  ChatAssistant,
  ChatMessage,
  ChatSession,
  CreateChatAssistantRequest,
  CreateChatSessionRequest,
  UpdateChatAssistantRequest,
  UpdateChatSessionRequest
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
    renameAwsAccount: (request: { accountId: string; name: string }) =>
      call<AwsAccountSummary>("rename_aws_account", request),
    updateAwsAccount: (request: AwsAccountUpdateInput) => call<AwsAccountSummary>("update_aws_account", request),
    testAwsAccount: (request: TestAwsAccountRequest) => call<AwsIdentity>("test_aws_account", request),
    setActiveAwsAccount: (request: { accountId: string }) => call<AwsAccountSummary>("set_active_aws_account", request),
    deleteAwsAccount: (request: { accountId: string }) => call("delete_aws_account", request),
    listAwsCliProfiles: () => call<AwsCliProfileSummary[]>("list_aws_cli_profiles"),
    importAwsCliProfile: (request: ImportAwsCliProfileRequest) => call<AwsAccount>("import_aws_cli_profile", request),
    loadAwsCliProfile: (request: { profileName: string }) =>
      call<AwsCliProfileCredentials>("load_aws_cli_profile", request),
    listVirtualClusters: (request: ListVirtualClustersRequest) =>
      call<ListVirtualClustersResponse>("list_virtual_clusters", request),
    listJobRuns: (request: {
      accountId?: string;
      virtualClusterId?: string;
      keyword?: string;
      createdAfterDays?: number;
    }) => call<JobRunSummary[]>("list_job_runs", request),
    syncJobRuns: (request: {
      accountId?: string;
      virtualClusterId?: string;
      createdAfterDays?: number;
    }) => call<number>("sync_job_runs", request),
    listSubmissionHistory: (request: { accountId?: string; virtualClusterId?: string }) =>
      call<JobRunSummary[]>("list_submission_history", request),
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
    prepareS3UploadFromDisk: (request: { bucket: string; prefix?: string }) =>
      call<S3UploadPrepareResult | undefined>("prepare_s3_upload_from_disk", request),
    uploadS3ObjectFromPath: (request: S3UploadFromPathRequest) =>
      call<S3ObjectEntry>("upload_s3_object_from_path", request),
    s3ObjectExists: (request: { bucket: string; key: string }) =>
      call<boolean>("s3_object_exists", request),
    uploadS3ObjectFromDisk: (request: { bucket: string; prefix?: string }) =>
      call<S3ObjectEntry | undefined>("upload_s3_object_from_disk", request),
    renameS3Object: (request: { accountId?: string; bucket: string; sourceKey: string; destinationKey: string }) =>
      call<S3ObjectEntry>("rename_s3_object", request),
    saveTextFile: (request: { suggestedName: string; content: string }) =>
      call<string | undefined>("save_text_file", request),
    openTextFile: () => call<string | undefined>("open_text_file"),
    deleteS3Object: (request: { accountId?: string; bucket: string; key: string }) =>
      call("delete_s3_object", request),
    createS3Folder: (request: { accountId?: string; bucket: string; parentPrefix?: string; folderName: string }) =>
      call<S3ObjectEntry>("create_s3_folder", request),
    describeS3PrefixDeletion: (request: { accountId?: string; bucket: string; key: string }) =>
      call<S3PrefixDeletionSummary>("describe_s3_prefix_deletion", request),
    deleteS3Prefix: (request: { accountId?: string; bucket: string; key: string }) =>
      call("delete_s3_prefix", request),
    listGlueDatabases: (request: GlueListRequest = {}) => call<GlueListDatabasesResponse>("list_glue_databases", request),
    listGlueTables: (request: GlueListRequest) => call<GlueListTablesResponse>("list_glue_tables", request),
    getGlueDatabase: (request: GlueGetDatabaseRequest) => call<GlueDatabaseDetail>("get_glue_database", request),
    updateGlueDatabase: (request: GlueUpdateDatabaseRequest) =>
      call<GlueDatabaseDetail>("update_glue_database", request),
    getGlueTable: (request: GlueGetTableRequest) => call<GlueTableDetail>("get_glue_table", request),
    updateGlueTable: (request: GlueUpdateTableRequest) => call<GlueTableDetail>("update_glue_table", request),
    listAthenaWorkgroups: (request: AwsCommandContext = {}) => call<AthenaWorkgroup[]>("list_athena_workgroups", request),
    startAthenaQuery: (request: StartAthenaQueryRequest) => call<AthenaQueryExecution>("start_athena_query", request),
    getAthenaQueryExecution: (request: AthenaQueryExecutionRequest) =>
      call<AthenaQueryExecution>("get_athena_query_execution", request),
    getAthenaQueryResults: (request: AthenaQueryResultsRequest) =>
      call<AthenaQueryResults>("get_athena_query_results", request),
    stopAthenaQuery: (request: AthenaQueryExecutionRequest) => call<AthenaQueryExecution>("stop_athena_query", request),
    exportAthenaQueryCsv: (request: ExportAthenaQueryCsvRequest) =>
      call<string | undefined>("export_athena_query_csv", request),
    checkPortableUpdate: () => call<PortableUpdateInfo | null>("check_portable_update"),
    installPortableUpdate: (request: PortableUpdateInfo) => call<void>("install_portable_update", request),
    mcpStart: (request?: { port?: number }) => call<McpStatus>("mcp_start", request),
    mcpStop: () => call<boolean>("mcp_stop"),
    mcpStatus: () => call<McpStatus>("mcp_status"),
    listMcpAuditEntries: (limit?: number) => call<McpAuditEntry[]>("list_mcp_audit_entries", { limit }),
    listLlmProviders: () => call<LlmProvider[]>("list_llm_providers"),
    createLlmProvider: (request: CreateLlmProviderRequest) => call<string>("create_llm_provider", request),
    updateLlmProvider: (request: UpdateLlmProviderRequest) => call<void>("update_llm_provider", request),
    deleteLlmProvider: (id: string) => call<void>("delete_llm_provider", { id }),
    createLlmEndpoint: (request: CreateLlmEndpointRequest) => call<string>("create_llm_endpoint", request),
    updateLlmEndpoint: (request: UpdateLlmEndpointRequest) => call<void>("update_llm_endpoint", request),
    deleteLlmEndpoint: (id: string) => call<void>("delete_llm_endpoint", { id }),
    testLlmEndpoint: (endpointId: string) => call<LlmEndpointTestResult>("test_llm_endpoint", { endpointId }),
    syncLlmModels: (endpointId: string) => call<LlmModelCandidate[]>("sync_llm_models", { endpointId }),
    addLlmModels: (request: AddLlmModelsRequest) => call<number>("add_llm_models", request),
    updateLlmModel: (request: UpdateLlmModelRequest) => call<void>("update_llm_model", request),
    deleteLlmModel: (id: string) => call<void>("delete_llm_model", { id }),
    listChatAssistants: () => call<ChatAssistant[]>("list_chat_assistants"),
    createChatAssistant: (request: CreateChatAssistantRequest) =>
      call<string>("create_chat_assistant", request),
    updateChatAssistant: (request: UpdateChatAssistantRequest) =>
      call<void>("update_chat_assistant", request),
    deleteChatAssistant: (id: string) => call<void>("delete_chat_assistant", { id }),
    listChatSessions: () => call<ChatSession[]>("list_chat_sessions"),
    createChatSession: (request: CreateChatSessionRequest) => call<string>("create_chat_session", request),
    updateChatSession: (request: UpdateChatSessionRequest) => call<void>("update_chat_session", request),
    deleteChatSession: (id: string) => call<void>("delete_chat_session", { id }),
    deleteAllChatSessions: () => call<number>("delete_all_chat_sessions"),
    listChatMessages: (sessionId: string) => call<ChatMessage[]>("list_chat_messages", { sessionId }),
    clearChatContext: (sessionId: string) => call<boolean>("clear_chat_context", { sessionId }),
    /**
     * Resolves when the whole exchange finishes, returning the assistant message
     * id. Progress arrives meanwhile on the CHAT_EVENTS channels.
     */
    chatSend: (sessionId: string, text: string) => call<string>("chat_send", { sessionId, text }),
    chatCancel: (sessionId: string) => call<boolean>("chat_cancel", { sessionId }),
    deleteChatMessage: (sessionId: string, messageId: string) =>
      call<void>("delete_chat_message", { sessionId, messageId }),
    deleteChatMessagesFrom: (sessionId: string, messageId: string) =>
      call<number>("delete_chat_messages_from", { sessionId, messageId }),
    /**
     * Re-answers the asked question, optionally on a different model. Resolves
     * when the exchange finishes, streaming on the CHAT_EVENTS channels.
     */
    regenerateChatMessage: (sessionId: string, messageId: string, modelId?: string) =>
      call<string>("regenerate_chat_message", { sessionId, messageId, modelId }),
    /**
     * Replaces a past question and re-answers it. Resolves when the exchange
     * finishes, streaming on the CHAT_EVENTS channels.
     */
    updateChatMessage: (sessionId: string, messageId: string, content: string) =>
      call<string>("update_chat_message", { sessionId, messageId, content })
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
