use crate::db::repository;
use crate::error::{AppError, AppResult};
use crate::models::{
    ApplicationTemplate, ResourceTemplate, TemplateMutationRequest, TemplatesResponse,
};
use crate::state::{default_application_template, default_resource_templates};

#[tauri::command]
pub async fn list_templates() -> AppResult<TemplatesResponse> {
    let pool = repository::pool().await?;
    let mut applications = repository::list_application_templates(&pool).await?;
    if applications.is_empty() {
        let template = default_application_template();
        repository::upsert_application_template(&pool, &template).await?;
        applications.push(template);
    }

    let mut resources = repository::list_resource_templates(&pool).await?;
    if resources.is_empty() {
        for template in default_resource_templates() {
            repository::upsert_resource_template(&pool, &template).await?;
            resources.push(template);
        }
    } else {
        let existing_ids: std::collections::HashSet<String> = resources
            .iter()
            .map(|template| template.id.clone())
            .collect();
        for template in default_resource_templates() {
            if !existing_ids.contains(&template.id) {
                repository::upsert_resource_template(&pool, &template).await?;
                resources.push(template);
            }
        }
        resources.sort_by(|left, right| left.name.cmp(&right.name));
    }

    Ok(TemplatesResponse {
        application_templates: applications.clone(),
        resource_templates: resources.clone(),
    })
}

#[tauri::command]
pub async fn create_template(request: serde_json::Value) -> AppResult<TemplatesResponse> {
    let pool = repository::pool().await?;
    if let Ok(template) = serde_json::from_value::<ApplicationTemplate>(request.clone()) {
        repository::upsert_application_template(&pool, &template).await?;
    } else if let Ok(template) = serde_json::from_value::<ResourceTemplate>(request) {
        repository::upsert_resource_template(&pool, &template).await?;
    } else {
        return Err(AppError::validation("Unsupported template payload."));
    }

    list_templates().await
}

#[tauri::command]
pub async fn update_template(request: serde_json::Value) -> AppResult<TemplatesResponse> {
    let pool = repository::pool().await?;
    if let Ok(template) = serde_json::from_value::<ApplicationTemplate>(request.clone()) {
        repository::upsert_application_template(&pool, &template).await?;
    } else if let Ok(template) = serde_json::from_value::<ResourceTemplate>(request) {
        repository::upsert_resource_template(&pool, &template).await?;
    } else {
        return Err(AppError::validation("Unsupported template payload."));
    }

    list_templates().await
}

#[tauri::command]
pub async fn delete_template(request: TemplateMutationRequest) -> AppResult<TemplatesResponse> {
    let pool = repository::pool().await?;
    repository::delete_template(&pool, &request.r#type, None, &request.id).await?;

    list_templates().await
}

#[tauri::command]
pub async fn duplicate_template(request: TemplateMutationRequest) -> AppResult<TemplatesResponse> {
    let pool = repository::pool().await?;
    match request.r#type.as_str() {
        "application" => {
            let templates = repository::list_application_templates(&pool).await?;
            let mut copy = templates
                .iter()
                .find(|template| template.id == request.id)
                .cloned()
                .ok_or_else(|| AppError::validation("Template was not found."))?;
            copy.id = uuid::Uuid::new_v4().to_string();
            copy.name = format!("{} Copy", copy.name);
            repository::upsert_application_template(&pool, &copy).await?;
        }
        "resource" => {
            let templates = repository::list_resource_templates(&pool).await?;
            let mut copy = templates
                .iter()
                .find(|template| template.id == request.id)
                .cloned()
                .ok_or_else(|| AppError::validation("Template was not found."))?;
            copy.id = uuid::Uuid::new_v4().to_string();
            copy.name = format!("{} Copy", copy.name);
            copy.built_in = false;
            repository::upsert_resource_template(&pool, &copy).await?;
        }
        _ => {
            return Err(AppError::validation(
                "Template type must be application or resource.",
            ))
        }
    }

    list_templates().await
}
