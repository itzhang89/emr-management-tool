use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::{JobConfigTemplate, JobConfigTemplateMutationRequest, JobConfigTemplatesResponse};
use crate::state::default_job_config_templates;

#[tauri::command]
pub async fn list_job_config_templates() -> AppResult<JobConfigTemplatesResponse> {
    let pool = repository::pool().await?;
    let mut templates = repository::list_job_config_templates(&pool).await?;
    let defaults = default_job_config_templates();
    for default_template in defaults {
        match templates
            .iter()
            .position(|template| template.id == default_template.id && template.built_in)
        {
            Some(index) => {
                if templates[index].name != default_template.name {
                    repository::upsert_job_config_template(&pool, &default_template).await?;
                    templates[index] = default_template;
                }
            }
            None if templates.is_empty() => {
                repository::upsert_job_config_template(&pool, &default_template).await?;
                templates.push(default_template);
            }
            None => {}
        }
    }

    Ok(JobConfigTemplatesResponse {
        job_config_templates: templates,
    })
}

#[tauri::command]
pub async fn create_job_config_template(
    request: JobConfigTemplate,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = repository::pool().await?;
    repository::upsert_job_config_template(&pool, &request).await?;
    list_job_config_templates().await
}

#[tauri::command]
pub async fn update_job_config_template(
    request: JobConfigTemplate,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = repository::pool().await?;
    repository::upsert_job_config_template(&pool, &request).await?;
    list_job_config_templates().await
}

#[tauri::command]
pub async fn delete_job_config_template(
    request: JobConfigTemplateMutationRequest,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = repository::pool().await?;
    repository::delete_template(&pool, "jobConfig", &request.id).await?;
    list_job_config_templates().await
}

#[tauri::command]
pub async fn duplicate_job_config_template(
    request: JobConfigTemplateMutationRequest,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = repository::pool().await?;
    let templates = repository::list_job_config_templates(&pool).await?;
    let mut copy = templates
        .iter()
        .find(|template| template.id == request.id)
        .cloned()
        .ok_or_else(|| AppError::validation("Template was not found."))?;
    copy.id = uuid::Uuid::new_v4().to_string();
    copy.name = format!("{} Copy", copy.name);
    copy.built_in = false;
    repository::upsert_job_config_template(&pool, &copy).await?;
    list_job_config_templates().await
}
