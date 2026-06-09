const EDITABLE_EXTENSIONS: &[&str] = &["sql", "yaml", "yml", "json", "conf", "properties", "txt"];
const EDITOR_LIMIT_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct S3ObjectEditability {
    pub editable: bool,
    pub previewable: bool,
    pub reason: Option<String>,
}

pub fn s3_object_editability(key: &str, size: u64) -> S3ObjectEditability {
    let extension = key
        .rsplit('/')
        .next()
        .and_then(|file_name| file_name.rsplit_once('.').map(|(_, extension)| extension.to_lowercase()))
        .unwrap_or_default();

    if !EDITABLE_EXTENSIONS.contains(&extension.as_str()) {
        return S3ObjectEditability {
            editable: false,
            previewable: false,
            reason: Some("File type is read-only.".to_string()),
        };
    }

    if size > EDITOR_LIMIT_BYTES {
        return S3ObjectEditability {
            editable: false,
            previewable: true,
            reason: Some("File is larger than the 5 MB editor limit.".to_string()),
        };
    }

    S3ObjectEditability {
        editable: true,
        previewable: true,
        reason: None,
    }
}

#[cfg(test)]
mod tests {
    use super::s3_object_editability;

    #[test]
    fn allows_documented_text_extensions() {
        let result = s3_object_editability("scripts/query.sql", 1024);

        assert!(result.editable);
        assert!(result.previewable);
        assert!(result.reason.is_none());
    }

    #[test]
    fn rejects_read_only_archive_extensions() {
        let result = s3_object_editability("jars/app.jar", 1024);

        assert!(!result.editable);
        assert!(!result.previewable);
    }

    #[test]
    fn large_text_file_is_preview_only() {
        let result = s3_object_editability("logs/app.txt", 6 * 1024 * 1024);

        assert!(!result.editable);
        assert!(result.previewable);
        assert_eq!(
            result.reason.as_deref(),
            Some("File is larger than the 5 MB editor limit.")
        );
    }
}
