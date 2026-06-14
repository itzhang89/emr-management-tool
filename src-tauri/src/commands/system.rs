use crate::error::AppResult;

#[tauri::command]
pub fn get_submit_user() -> AppResult<String> {
    let raw = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "user".to_string());
    Ok(sanitize_submit_user(&raw))
}

fn sanitize_submit_user(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '_'
            }
        })
        .collect();
    if sanitized.chars().all(|character| character == '_') {
        "user".to_string()
    } else {
        sanitized
    }
}

#[cfg(test)]
mod tests {
    use super::sanitize_submit_user;

    #[test]
    fn sanitizes_non_alphanumeric_characters() {
        assert_eq!(sanitize_submit_user("john.doe"), "john_doe");
        assert_eq!(sanitize_submit_user("***"), "user");
    }
}
