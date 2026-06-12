use crate::models::{
    ApplicationTemplate, AwsIdentity, AwsSettings, JobRunSummary, ResourceTemplate,
    SparkResourceConfig,
};
use chrono::Utc;
use std::collections::HashMap;
use std::sync::Mutex;

pub struct AppState {
    pub settings: Mutex<AwsSettings>,
    pub job_history: Mutex<Vec<JobRunSummary>>,
    pub application_templates: Mutex<Vec<ApplicationTemplate>>,
    pub resource_templates: Mutex<Vec<ResourceTemplate>>,
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
        resource_template_id: Some("small".to_string()),
        created_at: now,
        updated_at: now,
    }
}

pub fn default_resource_templates() -> Vec<ResourceTemplate> {
    let now = Utc::now();

    vec![
        ResourceTemplate {
            id: "small".to_string(),
            name: "Small".to_string(),
            resources: SparkResourceConfig {
                driver_cores: 1,
                driver_memory: "2G".to_string(),
                executor_cores: 2,
                executor_memory: "4G".to_string(),
                executor_instances: 2,
            },
            built_in: true,
            created_at: now,
            updated_at: now,
        },
        ResourceTemplate {
            id: "large".to_string(),
            name: "Large".to_string(),
            resources: SparkResourceConfig {
                driver_cores: 2,
                driver_memory: "8G".to_string(),
                executor_cores: 4,
                executor_memory: "16G".to_string(),
                executor_instances: 4,
            },
            built_in: true,
            created_at: now,
            updated_at: now,
        },
    ]
}
