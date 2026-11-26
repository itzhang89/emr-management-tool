use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::{
    AccountTemplateVariables, AccountTemplateVariablesRequest, JobConfigTemplateMutationRequest,
    JobConfigTemplateSaveRequest, JobConfigTemplateScope, JobConfigTemplateScopeRequest,
    JobConfigTemplatesResponse, TemplateAccountRequest,
};
use crate::state::default_job_config_templates;
use chrono::Utc;
use sqlx::SqlitePool;

const BUILTIN_VARIABLES: &[&str] = &[
    "template_name",
    "virtualClusterId",
    "submitUser",
    "AWS_USERNAME",
    "AWS_ACCOUNT_ID",
    "AWS_REGION",
    "date",
    "datetime",
];

async fn account_pool(account_id: &str) -> AppResult<SqlitePool> {
    let pool = repository::pool().await?;
    if repository::get_aws_account(&pool, account_id)
        .await?
        .is_none()
    {
        return Err(AppError::validation("AWS account was not found."));
    }
    Ok(pool)
}

async fn templates_for_account(
    pool: &SqlitePool,
    account_id: &str,
) -> AppResult<JobConfigTemplatesResponse> {
    prepare_account_templates(pool, account_id).await?;
    Ok(JobConfigTemplatesResponse {
        job_config_templates: repository::list_job_config_templates(pool, account_id).await?,
    })
}

async fn prepare_account_templates(pool: &SqlitePool, account_id: &str) -> AppResult<()> {
    repository::migrate_job_config_templates_to_account(pool, account_id).await?;
    for template in default_job_config_templates() {
        repository::seed_job_config_template(pool, account_id, &template).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn list_job_config_templates(
    request: TemplateAccountRequest,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = account_pool(&request.account_id).await?;
    templates_for_account(&pool, &request.account_id).await
}

#[tauri::command]
pub async fn create_job_config_template(
    mut request: JobConfigTemplateSaveRequest,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = account_pool(&request.account_id).await?;
    if default_job_config_templates()
        .iter()
        .any(|template| template.id == request.template.id)
    {
        return Err(AppError::validation(
            "This ID is reserved for a built-in template.",
        ));
    }
    request.template.built_in = false;
    let now = Utc::now();
    request.template.created_at = now;
    request.template.updated_at = now;
    if request.resolve_import_name {
        prepare_account_templates(&pool, &request.account_id).await?;
        repository::import_job_config_template(&pool, &request.account_id, request.template)
            .await?;
        return Ok(JobConfigTemplatesResponse {
            job_config_templates: repository::list_job_config_templates(&pool, &request.account_id)
                .await?,
        });
    }
    repository::create_job_config_template(&pool, &request.account_id, &request.template).await?;
    templates_for_account(&pool, &request.account_id).await
}

#[tauri::command]
pub async fn update_job_config_template(
    mut request: JobConfigTemplateSaveRequest,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = account_pool(&request.account_id).await?;
    request.template.updated_at = Utc::now();
    repository::update_job_config_template(&pool, &request.account_id, &request.template).await?;
    templates_for_account(&pool, &request.account_id).await
}

#[tauri::command]
pub async fn set_job_config_template_scope(
    request: JobConfigTemplateScopeRequest,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = account_pool(&request.account_id).await?;
    repository::set_job_config_template_scope(
        &pool,
        &request.account_id,
        &request.id,
        request.scope,
    )
    .await?;
    templates_for_account(&pool, &request.account_id).await
}

#[tauri::command]
pub async fn delete_job_config_template(
    request: JobConfigTemplateMutationRequest,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = account_pool(&request.account_id).await?;
    repository::delete_job_config_template(&pool, &request.account_id, &request.id).await?;
    templates_for_account(&pool, &request.account_id).await
}

#[tauri::command]
pub async fn duplicate_job_config_template(
    request: JobConfigTemplateMutationRequest,
) -> AppResult<JobConfigTemplatesResponse> {
    let pool = account_pool(&request.account_id).await?;
    let mut copy = repository::list_job_config_templates(&pool, &request.account_id)
        .await?
        .into_iter()
        .find(|template| template.id == request.id)
        .ok_or_else(|| AppError::validation("Template was not found."))?;
    copy.id = uuid::Uuid::new_v4().to_string();
    copy.name = format!("{} Copy", copy.name);
    copy.built_in = false;
    copy.scope = JobConfigTemplateScope::Private;
    let now = Utc::now();
    copy.created_at = now;
    copy.updated_at = now;
    repository::create_job_config_template(&pool, &request.account_id, &copy).await?;
    templates_for_account(&pool, &request.account_id).await
}

async fn active_account_variables_pool(account_id: &str) -> AppResult<SqlitePool> {
    let pool = repository::pool().await?;
    if repository::active_aws_account(&pool)
        .await?
        .is_some_and(|account| account.id == account_id)
    {
        Ok(pool)
    } else {
        Err(AppError::validation(
            "Template variables are available for the active AWS account only.",
        ))
    }
}

#[tauri::command]
pub async fn list_account_template_variables(
    request: TemplateAccountRequest,
) -> AppResult<AccountTemplateVariables> {
    let pool = active_account_variables_pool(&request.account_id).await?;
    repository::list_account_template_variables(&pool, &request.account_id).await
}

#[tauri::command]
pub async fn save_account_template_variables(
    request: AccountTemplateVariablesRequest,
) -> AppResult<AccountTemplateVariables> {
    for name in request.variables.keys() {
        if name.is_empty()
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            || BUILTIN_VARIABLES.contains(&name.as_str())
        {
            return Err(AppError::validation(format!(
                "Invalid or reserved variable name: {name}"
            )));
        }
    }
    let pool = active_account_variables_pool(&request.account_id).await?;
    repository::save_account_template_variables(&pool, &request.account_id, &request.variables)
        .await?;
    Ok(request.variables)
}
