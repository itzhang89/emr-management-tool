use crate::error::{AppError, AppResult};
use crate::models::SaveTextFileRequest;

#[tauri::command]
pub async fn save_text_file(request: SaveTextFileRequest) -> AppResult<Option<String>> {
    let suggested_name = sanitize_file_name(&request.suggested_name);
    let path = rfd::AsyncFileDialog::new()
        .set_file_name(&suggested_name)
        .save_file()
        .await;

    let Some(path) = path else {
        return Ok(None);
    };

    tokio::fs::write(path.path(), request.content)
        .await
        .map_err(|error| AppError::storage(format!("Failed to save file: {error}")))?;

    Ok(Some(path.path().to_string_lossy().into_owned()))
}

fn sanitize_file_name(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric()
                || character == '.'
                || character == '-'
                || character == '_'
            {
                character
            } else {
                '-'
            }
        })
        .collect::<String>();

    sanitized.trim_matches('-').to_string()
}

#[tauri::command]
pub async fn open_text_file() -> AppResult<Option<String>> {
    let file = rfd::AsyncFileDialog::new()
        .add_filter("JSON", &["json"])
        .add_filter("Text", &["txt"])
        .pick_file()
        .await;

    let Some(file) = file else {
        return Ok(None);
    };

    let content = tokio::fs::read_to_string(file.path())
        .await
        .map_err(|error| AppError::storage(format!("Failed to read selected file: {error}")))?;

    Ok(Some(content))
}

#[cfg(test)]
mod tests {
    use super::sanitize_file_name;

    #[test]
    fn sanitizes_download_file_names() {
        assert_eq!(
            sanitize_file_name("job-1/driver stdout.log"),
            "job-1-driver-stdout.log"
        );
    }
}
