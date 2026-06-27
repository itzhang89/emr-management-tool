use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::{
    JobConfigTemplate, JobConfigTemplateMutationRequest, JobConfigTemplatesResponse,
};
use crate::state::default_job_config_templates;
use tauri::AppHandle;

async fn active_account_id() -> AppResult<String> {
    let pool = repository::pool().await?;
    repository::active_aws_account(&pool)
        .await?
        .map(|account| account.id)
        .ok_or_else(|| AppError::validation("No active AWS account."))
}

async fn list_job_config_templates_for_active_account(
    _app: &AppHandle,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = repository::pool().await?;
    let account_id = active_account_id().await?;
    repository::migrate_job_config_templates_to_account(&pool, &account_id).await?;
    let mut templates = repository::list_job_config_templates(&pool, &account_id).await?;
    let defaults = default_job_config_templates();
    for default_template in defaults {
        match templates
            .iter()
            .position(|template| template.id == default_template.id && template.built_in)
        {
            Some(index) => {
                if templates[index].name != default_template.name {
                    repository::upsert_job_config_template(&pool, &account_id, &default_template)
                        .await?;
                    templates[index] = default_template;
                }
            }
            None => {
                repository::upsert_job_config_template(&pool, &account_id, &default_template)
                    .await?;
                templates.push(default_template);
            }
        }
    }

    Ok(JobConfigTemplatesResponse {
        job_config_templates: templates,
    })
}

#[tauri::command]
pub async fn list_job_config_templates(app: AppHandle) -> AppResult<JobConfigTemplatesResponse> {
    list_job_config_templates_for_active_account(&app).await
}

#[tauri::command]
pub async fn create_job_config_template(
    app: AppHandle,
    request: JobConfigTemplate,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = repository::pool().await?;
    let account_id = active_account_id().await?;
    repository::upsert_job_config_template(&pool, &account_id, &request).await?;
    list_job_config_templates_for_active_account(&app).await
}

#[tauri::command]
pub async fn update_job_config_template(
    app: AppHandle,
    request: JobConfigTemplate,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = repository::pool().await?;
    let account_id = active_account_id().await?;
    repository::upsert_job_config_template(&pool, &account_id, &request).await?;
    list_job_config_templates_for_active_account(&app).await
}

#[tauri::command]
pub async fn delete_job_config_template(
    app: AppHandle,
    request: JobConfigTemplateMutationRequest,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = repository::pool().await?;
    let account_id = active_account_id().await?;
    repository::delete_template(&pool, "jobConfig", Some(&account_id), &request.id).await?;
    list_job_config_templates_for_active_account(&app).await
}

#[tauri::command]
pub async fn duplicate_job_config_template(
    app: AppHandle,
    request: JobConfigTemplateMutationRequest,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = repository::pool().await?;
    let account_id = active_account_id().await?;
    let templates = repository::list_job_config_templates(&pool, &account_id).await?;
    let mut copy = templates
        .iter()
        .find(|template| template.id == request.id)
        .cloned()
        .ok_or_else(|| AppError::validation("Template was not found."))?;
    copy.id = uuid::Uuid::new_v4().to_string();
    copy.name = format!("{} Copy", copy.name);
    copy.built_in = false;
    copy.account_id = Some(account_id.clone());
    repository::upsert_job_config_template(&pool, &account_id, &copy).await?;
    list_job_config_templates_for_active_account(&app).await
}
