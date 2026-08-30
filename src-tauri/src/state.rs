use crate::models::{
    ApplicationTemplate, AwsIdentity, AwsSettings, JobConfigTemplate, JobRunSummary,
    ResourceTemplate, SparkResourceConfig, TemplateVariableDefinition,
};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct AppState {
    pub settings: Mutex<AwsSettings>,
    pub job_history: Mutex<Vec<JobRunSummary>>,
    pub application_templates: Mutex<Vec<ApplicationTemplate>>,
    pub resource_templates: Mutex<Vec<ResourceTemplate>>,
    pub mcp_state: Mutex<McpState>,
    /// The Chat page's MCP client, connected lazily on the first tool call and
    /// then resident. Independent of `mcp_state`: Chat works whether or not the
    /// Streamable HTTP endpoint external agents use is running.
    pub in_process_mcp: crate::mcp::in_process::InProcessClient,
    /// One cancellation token per streaming chat send, keyed by session id, so
    /// the UI's stop button can interrupt the request it belongs to.
    pub chat_cancellations: Mutex<HashMap<String, tokio_util::sync::CancellationToken>>,
}

/// State for the in-process MCP server. The axum task is spawned inside the
/// app process and aborted on stop, so nothing can outlive the app — there is
/// no child process to track.
#[derive(Default)]
pub struct McpState {
    pub task: Option<tokio::task::JoinHandle<()>>,
    pub mcp_port: Option<u16>,
    pub transport: Option<String>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            settings: Mutex::new(AwsSettings {
                region: "us-east-1".to_string(),
                has_saved_credentials: false,
                identity: None::<AwsIdentity>,
            }),
            job_history: Mutex::new(Vec::new()),
            application_templates: Mutex::new(Vec::new()),
            resource_templates: Mutex::new(default_resource_templates()),
            mcp_state: Mutex::new(McpState::default()),
            in_process_mcp: crate::mcp::in_process::InProcessClient::new(),
            chat_cancellations: Mutex::new(HashMap::new()),
        }
    }
}

pub fn default_application_template() -> ApplicationTemplate {
    let now = Utc::now();

    ApplicationTemplate {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Daily ETL Jar".to_string(),
        description: "Starter Jar application template".to_string(),
        jar_path: "s3://bucket/jobs/app.jar".to_string(),
        main_class: "com.example.Main".to_string(),
        default_arguments: vec!["--date=${date}".to_string(), "--env=prod".to_string()],
        spark_config: HashMap::from([(
            "spark.sql.shuffle.partitions".to_string(),
            "200".to_string(),
        )]),
        resource_template_id: Some("tiny".to_string()),
        created_at: now,
        updated_at: now,
    }
}

pub fn default_resource_templates() -> Vec<ResourceTemplate> {
    let now = Utc::now();

    let presets = [
        ("tiny", "Tiny", 1, "1G", 1, "1G", 1),
        ("small", "Small", 1, "2G", 2, "2G", 2),
        ("medium", "Medium", 1, "4G", 2, "4G", 2),
        ("large", "Large", 1, "8G", 4, "8G", 2),
        ("xlarge", "XLarge", 1, "16G", 4, "16G", 2),
    ];
    presets
        .into_iter()
        .map(|preset| builtin_resource_template(preset, now))
        .collect()
}

pub fn default_job_config_templates() -> Vec<JobConfigTemplate> {
    let now = Utc::now();
    let payload_template = r#"{
  "name": "${template_name}-${submitUser}-${date:YYYY-MM-DD}",
  "virtualClusterId": "${virtualClusterId}",
  "executionRoleArn": "arn:aws:iam::123456789012:role/EMRContainers-JobExecutionRole",
  "releaseLabel": "emr-7.2.0-latest",
  "jobDriver": {
    "sparkSubmitJobDriver": {
      "entryPoint": "s3://bucket/jobs/app.jar",
      "entryPointArguments": ["--env=${ENV}"],
      "sparkSubmitParameters": "--class com.example.Main"
    }
  },
  "configurationOverrides": {
    "applicationConfiguration": [
      {
        "classification": "spark-defaults",
        "properties": {
          "spark.driver.cores": "1",
          "spark.driver.memory": "1G",
          "spark.executor.cores": "1",
          "spark.executor.memory": "1G",
          "spark.executor.instances": "1"
        }
      }
    ],
    "monitoringConfiguration": {
      "cloudWatchMonitoringConfiguration": {
        "logGroupName": "/aws/emr-containers/jobs",
        "logStreamNamePrefix": "${submitUser}"
      }
    }
  }
}"#;

    vec![JobConfigTemplate {
        id: "daily-etl".to_string(),
        account_id: None,
        name: "example".to_string(),
        description: Some(
            "Reference template showing how to configure an EMR submit payload.".to_string(),
        ),
        payload_template: payload_template.to_string(),
        custom_variables: vec![TemplateVariableDefinition {
            name: "ENV".to_string(),
            label: Some("Environment".to_string()),
            description: Some("Runtime environment used by the example Spark job.".to_string()),
            r#type: "enum".to_string(),
            default_value: Some(serde_json::json!("prod")),
            options: Some(vec![
                "dev".to_string(),
                "staging".to_string(),
                "prod".to_string(),
            ]),
            format: None,
            required: Some(true),
        }],
        default_resource_template_id: Some("tiny".to_string()),
        built_in: true,
        created_at: now,
        updated_at: now,
    }]
}

fn builtin_resource_template(
    (id, name, driver_cores, driver_memory, executor_cores, executor_memory, executor_instances): (
        &str,
        &str,
        i32,
        &str,
        i32,
        &str,
        i32,
    ),
    now: chrono::DateTime<Utc>,
) -> ResourceTemplate {
    ResourceTemplate {
        id: id.to_string(),
        name: name.to_string(),
        resources: SparkResourceConfig {
            driver_cores,
            driver_memory: driver_memory.to_string(),
            executor_cores,
            executor_memory: executor_memory.to_string(),
            executor_instances,
        },
        built_in: true,
        created_at: now,
        updated_at: now,
    }
}
