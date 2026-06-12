use crate::error::{AppError, AppResult};
use crate::models::AwsCliProfileSummary;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImportableAwsCliProfile {
    pub profile_name: String,
    pub access_key_id: String,
    pub secret_access_key: String,
    pub session_token: Option<String>,
    pub region: String,
}

pub fn discover_aws_cli_profiles() -> AppResult<Vec<AwsCliProfileSummary>> {
    let credentials = read_aws_file("credentials")?;
    let config = read_aws_file("config")?;
    Ok(discover_profiles_from_contents(&credentials, &config))
}

pub fn load_aws_cli_profile_credentials(profile_name: &str) -> AppResult<ImportableAwsCliProfile> {
    let credentials = read_aws_file("credentials")?;
    let config = read_aws_file("config")?;
    importable_profile_credentials(profile_name, &credentials, &config)
}

pub fn discover_profiles_from_contents(
    credentials: &str,
    config: &str,
) -> Vec<AwsCliProfileSummary> {
    let credential_profiles = parse_ini(credentials, IniSectionKind::Credentials);
    let config_profiles = parse_ini(config, IniSectionKind::Config);
    let mut names = BTreeSet::new();
    names.extend(credential_profiles.keys().cloned());
    names.extend(config_profiles.keys().cloned());

    names.into_iter()
        .map(|profile_name| {
            let credential_section = credential_profiles.get(&profile_name);
            let config_section = config_profiles.get(&profile_name);
            let access_key_id = credential_section.and_then(|section| section.get("aws_access_key_id"));
            let secret_access_key = credential_section.and_then(|section| section.get("aws_secret_access_key"));
            let has_static_credentials = access_key_id.is_some_and(|value| !value.trim().is_empty())
                && secret_access_key.is_some_and(|value| !value.trim().is_empty());

            AwsCliProfileSummary {
                profile_name,
                region: credential_section
                    .and_then(|section| section.get("region"))
                    .or_else(|| config_section.and_then(|section| section.get("region")))
                    .cloned(),
                access_key_id_masked: access_key_id.map(|value| mask_access_key(value)),
                can_import: has_static_credentials,
                import_error: if has_static_credentials {
                    None
                } else {
                    Some("Profile does not contain static aws_access_key_id and aws_secret_access_key values.".to_string())
                },
            }
        })
        .collect()
}

pub fn importable_profile_credentials(
    profile_name: &str,
    credentials: &str,
    config: &str,
) -> AppResult<ImportableAwsCliProfile> {
    let credential_profiles = parse_ini(credentials, IniSectionKind::Credentials);
    let config_profiles = parse_ini(config, IniSectionKind::Config);
    let credential_section = credential_profiles.get(profile_name).ok_or_else(|| {
        AppError::validation(format!(
            "AWS CLI profile {profile_name} was not found in credentials."
        ))
    })?;
    let access_key_id = required_value(credential_section, "aws_access_key_id", profile_name)?;
    let secret_access_key =
        required_value(credential_section, "aws_secret_access_key", profile_name)?;
    let region = credential_section
        .get("region")
        .or_else(|| {
            config_profiles
                .get(profile_name)
                .and_then(|section| section.get("region"))
        })
        .cloned()
        .unwrap_or_else(|| "us-east-1".to_string());

    Ok(ImportableAwsCliProfile {
        profile_name: profile_name.to_string(),
        access_key_id,
        secret_access_key,
        session_token: credential_section
            .get("aws_session_token")
            .filter(|value| !value.trim().is_empty())
            .cloned(),
        region,
    })
}

fn required_value(
    section: &BTreeMap<String, String>,
    key: &str,
    profile_name: &str,
) -> AppResult<String> {
    section
        .get(key)
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or_else(|| {
            AppError::validation(format!("AWS CLI profile {profile_name} is missing {key}."))
        })
}

fn read_aws_file(file_name: &str) -> AppResult<String> {
    let path = aws_dir()?.join(file_name);
    match fs::read_to_string(&path) {
        Ok(contents) => Ok(contents),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(error) => Err(AppError::storage(format!(
            "Unable to read AWS CLI {file_name}: {error}"
        ))),
    }
}

fn aws_dir() -> AppResult<PathBuf> {
    dirs::home_dir().map(|dir| dir.join(".aws")).ok_or_else(|| {
        AppError::storage("Unable to locate the home directory for AWS CLI profile discovery.")
    })
}

#[derive(Clone, Copy)]
enum IniSectionKind {
    Credentials,
    Config,
}

fn parse_ini(
    contents: &str,
    section_kind: IniSectionKind,
) -> BTreeMap<String, BTreeMap<String, String>> {
    let mut sections: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    let mut current_section: Option<String> = None;

    for raw_line in contents.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some(section_name) = line
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
        {
            current_section = normalize_section_name(section_name.trim(), section_kind);
            if let Some(name) = &current_section {
                sections.entry(name.clone()).or_default();
            }
            continue;
        }
        let Some(section_name) = current_section.as_ref() else {
            continue;
        };
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        sections
            .entry(section_name.clone())
            .or_default()
            .insert(key.trim().to_string(), value.trim().to_string());
    }

    sections
}

fn normalize_section_name(section_name: &str, section_kind: IniSectionKind) -> Option<String> {
    match section_kind {
        IniSectionKind::Credentials => Some(section_name.to_string()),
        IniSectionKind::Config => {
            if section_name == "default" {
                Some(section_name.to_string())
            } else {
                section_name
                    .strip_prefix("profile ")
                    .map(ToString::to_string)
            }
        }
    }
}

fn mask_access_key(access_key_id: &str) -> String {
    let trimmed = access_key_id.trim();
    if trimmed.len() <= 8 {
        return "********".to_string();
    }
    format!("{}****{}", &trimmed[..4], &trimmed[trimmed.len() - 4..])
}

#[cfg(test)]
mod tests {
    use super::{discover_profiles_from_contents, importable_profile_credentials};

    #[test]
    fn discovers_static_credential_profiles_without_returning_secret_values() {
        let credentials = r#"
[default]
aws_access_key_id = AKIADEFAULT1234
aws_secret_access_key = default-secret

[dev]
aws_access_key_id = AKIADEV5678
aws_secret_access_key = dev-secret
"#;
        let config = r#"
[default]
region = us-west-2

[profile dev]
region = us-east-1
"#;

        let profiles = discover_profiles_from_contents(credentials, config);

        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles[0].profile_name, "default");
        assert_eq!(profiles[0].region.as_deref(), Some("us-west-2"));
        assert_eq!(
            profiles[0].access_key_id_masked.as_deref(),
            Some("AKIA****1234")
        );
        assert!(profiles[0].can_import);
        assert_eq!(profiles[1].profile_name, "dev");
        assert_eq!(profiles[1].region.as_deref(), Some("us-east-1"));
        assert_eq!(
            profiles[1].access_key_id_masked.as_deref(),
            Some("AKIA****5678")
        );
        assert!(profiles[1].can_import);
    }

    #[test]
    fn reports_profiles_without_static_secrets_as_not_importable() {
        let credentials = r#"
[sso-dev]
aws_access_key_id = AKIAONLYKEY1234
"#;
        let config = r#"
[profile sso-dev]
region = us-east-1
sso_session = team
"#;

        let profiles = discover_profiles_from_contents(credentials, config);

        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].profile_name, "sso-dev");
        assert_eq!(
            profiles[0].access_key_id_masked.as_deref(),
            Some("AKIA****1234")
        );
        assert!(!profiles[0].can_import);
        assert_eq!(
            profiles[0].import_error.as_deref(),
            Some("Profile does not contain static aws_access_key_id and aws_secret_access_key values.")
        );
    }

    #[test]
    fn imports_static_profile_credentials_with_region_from_config() {
        let credentials = r#"
[dev]
aws_access_key_id = AKIADEV5678
aws_secret_access_key = dev-secret
"#;
        let config = r#"
[profile dev]
region = us-east-1
"#;

        let profile =
            importable_profile_credentials("dev", credentials, config).expect("profile imports");

        assert_eq!(profile.profile_name, "dev");
        assert_eq!(profile.region, "us-east-1");
        assert_eq!(profile.access_key_id, "AKIADEV5678");
        assert_eq!(profile.secret_access_key, "dev-secret");
    }
}
