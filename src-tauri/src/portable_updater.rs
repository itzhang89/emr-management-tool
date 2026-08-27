use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Cursor;
use std::path::{Component, Path};

pub const PORTABLE_UPDATER_ENDPOINT: &str =
    "https://github.com/itzhang89/emr-management-tool/releases/download/stable-channel-portable/portable-latest.json";

pub fn app_version() -> &'static str {
    option_env!("EMR_APP_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"))
}

pub fn updater_public_key() -> &'static str {
    option_env!("EMR_UPDATER_PUBLIC_KEY").unwrap_or(
        "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEI4MEI1NUUzRTE0NkM2RQpSV1J1YkJRK1hyV0FDOW05YjRsVHJEeURrcUt4VVJvMS9lck00Y1FqM2JLUmtxZDduL1hOYytVdAo="
    )
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortableUpdateInfo {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub url: String,
    pub signature: String,
}

#[derive(Debug, Deserialize)]
struct PortableManifest {
    version: String,
    notes: Option<String>,
    platforms: HashMap<String, PortablePlatformAsset>,
}

#[derive(Debug, Deserialize)]
struct PortablePlatformAsset {
    url: String,
    signature: String,
}

pub fn is_newer_version(candidate: &str, current: &str) -> bool {
    let parse_semver = |v: &str| {
        let trimmed = v.trim().trim_start_matches('v');
        semver::Version::parse(trimmed)
    };
    match (parse_semver(candidate), parse_semver(current)) {
        (Ok(cand_ver), Ok(curr_ver)) => cand_ver > curr_ver,
        _ => false,
    }
}

pub fn should_skip_archive_entry(path: &Path) -> bool {
    for component in path.components() {
        if let Component::Normal(os_str) = component {
            let s = os_str.to_string_lossy();
            if s.eq_ignore_ascii_case("data") {
                return true;
            }
        }
    }
    false
}

pub fn is_allowed_portable_asset_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    if !lower.starts_with("https://") {
        return false;
    }
    if !(lower.ends_with(".zip") && lower.contains("portable")) {
        return false;
    }
    if lower.starts_with("https://github.com/itzhang89/emr-management-tool/releases/")
        || lower.starts_with("https://github-production-release-asset-")
        || lower.starts_with("https://objects.githubusercontent.com/")
    {
        return true;
    }
    false
}

pub fn verify_signature(
    data: &[u8],
    signature_str: &str,
    pubkey_str: &str,
) -> Result<(), AppError> {
    let pubkey = minisign_verify::PublicKey::decode(pubkey_str.trim())
        .map_err(|e| AppError::validation(format!("Invalid updater public key: {e}")))?;
    let signature = minisign_verify::Signature::decode(signature_str.trim())
        .map_err(|e| AppError::validation(format!("Invalid update signature: {e}")))?;
    pubkey
        .verify(data, &signature, false)
        .map_err(|e| AppError::validation(format!("Update signature verification failed: {e}")))?;
    Ok(())
}

pub fn apply_portable_archive(
    zip_bytes: &[u8],
    target_dir: &Path,
    current_exe: &Path,
) -> Result<(), AppError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(zip_bytes))
        .map_err(|e| AppError::validation(format!("Invalid zip archive: {e}")))?;

    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .map_err(|e| AppError::validation(format!("Corrupt zip entry: {e}")))?;
        let entry_path = file
            .enclosed_name()
            .ok_or_else(|| AppError::validation("Zip entry path escapes destination directory."))?;
        if should_skip_archive_entry(&entry_path) {
            continue;
        }
    }

    let old_exe_path = current_exe.with_extension("exe.old");
    let mut renamed_old_exe = false;

    if current_exe.exists() {
        if old_exe_path.exists() {
            let _ = fs::remove_file(&old_exe_path);
        }
        if let Err(e) = fs::rename(current_exe, &old_exe_path) {
            return Err(AppError::storage(format!(
                "Failed to rename running executable for replacement: {e}"
            )));
        }
        renamed_old_exe = true;
    }

    let extract_result = (|| -> Result<(), AppError> {
        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| AppError::validation(format!("Corrupt zip entry: {e}")))?;
            let entry_path = match file.enclosed_name() {
                Some(p) => p.to_path_buf(),
                None => continue,
            };

            if should_skip_archive_entry(&entry_path) {
                continue;
            }

            let out_path = target_dir.join(&entry_path);

            if file.is_dir() {
                fs::create_dir_all(&out_path).map_err(|e| {
                    AppError::storage(format!(
                        "Failed to create directory {}: {e}",
                        out_path.display()
                    ))
                })?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| {
                        AppError::storage(format!(
                            "Failed to create directory {}: {e}",
                            parent.display()
                        ))
                    })?;
                }
                let mut out_file = File::create(&out_path).map_err(|e| {
                    AppError::storage(format!("Failed to create file {}: {e}", out_path.display()))
                })?;
                std::io::copy(&mut file, &mut out_file).map_err(|e| {
                    AppError::storage(format!("Failed to write file {}: {e}", out_path.display()))
                })?;
            }
        }
        Ok(())
    })();

    if let Err(err) = extract_result {
        if renamed_old_exe && old_exe_path.exists() && !current_exe.exists() {
            let _ = fs::rename(&old_exe_path, current_exe);
        }
        return Err(err);
    }

    Ok(())
}

pub fn cleanup_old_executables(exe_dir: &Path) {
    if let Ok(entries) = fs::read_dir(exe_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(ext) = path.extension() {
                if ext.eq_ignore_ascii_case("old") {
                    let _ = fs::remove_file(path);
                }
            }
        }
    }
}

pub async fn check_portable_update() -> Result<Option<PortableUpdateInfo>, AppError> {
    if !crate::distribution::is_portable() {
        return Err(AppError::validation(
            "Portable updates are only supported on portable builds.",
        ));
    }

    let channel = option_env!("EMR_APP_CHANNEL").unwrap_or("stable");
    if channel != "stable" {
        return Ok(None);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::internal(format!("Failed to build HTTP client: {e}")))?;

    let response = client
        .get(PORTABLE_UPDATER_ENDPOINT)
        .header("User-Agent", "emr-management-tool-portable-updater")
        .send()
        .await
        .map_err(|e| {
            AppError::internal(format!("Failed to fetch portable update manifest: {e}"))
        })?;

    if !response.status().is_success() {
        return Err(AppError::internal(format!(
            "Failed to fetch portable update manifest: HTTP {}",
            response.status()
        )));
    }

    let manifest: PortableManifest = response.json().await.map_err(|e| {
        AppError::internal(format!("Failed to parse portable update manifest: {e}"))
    })?;

    let platform_asset = manifest
        .platforms
        .get("windows-x86_64")
        .or_else(|| manifest.platforms.get("windows-amd64"))
        .ok_or_else(|| {
            AppError::validation("No Windows portable asset found in update manifest.")
        })?;

    let current = app_version();
    if is_newer_version(&manifest.version, current) {
        Ok(Some(PortableUpdateInfo {
            version: manifest.version,
            current_version: current.to_string(),
            notes: manifest.notes,
            url: platform_asset.url.clone(),
            signature: platform_asset.signature.clone(),
        }))
    } else {
        Ok(None)
    }
}

pub async fn install_portable_update(
    app: &tauri::AppHandle,
    update: &PortableUpdateInfo,
) -> Result<(), AppError> {
    if !crate::distribution::is_portable() {
        return Err(AppError::validation(
            "Portable updates are only supported on portable builds.",
        ));
    }

    if !is_allowed_portable_asset_url(&update.url) {
        return Err(AppError::validation(format!(
            "Untrusted or invalid update URL: {}",
            update.url
        )));
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::internal(format!("Failed to build HTTP client: {e}")))?;

    let response = client
        .get(&update.url)
        .header("User-Agent", "emr-management-tool-portable-updater")
        .send()
        .await
        .map_err(|e| AppError::internal(format!("Failed to download update package: {e}")))?;

    if !response.status().is_success() {
        return Err(AppError::internal(format!(
            "Failed to download update package: HTTP {}",
            response.status()
        )));
    }

    let zip_bytes = response
        .bytes()
        .await
        .map_err(|e| AppError::internal(format!("Failed to read update package payload: {e}")))?;

    let pubkey = updater_public_key();
    verify_signature(&zip_bytes, &update.signature, pubkey)?;

    let current_exe = std::env::current_exe()
        .map_err(|e| AppError::storage(format!("Unable to locate running executable: {e}")))?;
    let exe_dir = current_exe
        .parent()
        .ok_or_else(|| AppError::storage("Unable to locate running executable directory."))?;

    apply_portable_archive(&zip_bytes, exe_dir, &current_exe)?;

    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn skip_archive_entry_protects_data_directory() {
        assert!(should_skip_archive_entry(Path::new("data/emr.sqlite")));
        assert!(should_skip_archive_entry(Path::new(
            "DATA/credentials.json"
        )));
        assert!(should_skip_archive_entry(Path::new("nested/data/foo.txt")));
        assert!(should_skip_archive_entry(Path::new("data")));
        assert!(!should_skip_archive_entry(Path::new(
            "EMR Management Tool Portable.exe"
        )));
        assert!(!should_skip_archive_entry(Path::new("resources/app.ico")));
    }

    #[test]
    fn allowed_portable_asset_url_validation() {
        assert!(is_allowed_portable_asset_url(
            "https://github.com/itzhang89/emr-management-tool/releases/download/v0.2.0/windows-amd64-portable.zip"
        ));
        assert!(is_allowed_portable_asset_url(
            "https://objects.githubusercontent.com/github-production-release-asset-2e65be/123/windows-amd64-portable.zip"
        ));
        assert!(!is_allowed_portable_asset_url(
            "https://evil.example.com/portable.zip"
        ));
        assert!(!is_allowed_portable_asset_url(
            "https://github.com/itzhang89/emr-management-tool/releases/download/v0.2.0/installer-setup.exe"
        ));
        assert!(!is_allowed_portable_asset_url(
            "http://github.com/itzhang89/emr-management-tool/releases/download/v0.2.0/windows-amd64-portable.zip"
        ));
    }

    #[test]
    fn version_comparison_logic() {
        assert!(is_newer_version("0.2.0", "0.1.0"));
        assert!(is_newer_version("v1.0.0", "0.9.9"));
        assert!(is_newer_version("0.1.1", "0.1.0"));
        assert!(!is_newer_version("0.1.0", "0.1.0"));
        assert!(!is_newer_version("0.0.9", "0.1.0"));
        assert!(!is_newer_version("invalid", "0.1.0"));
    }

    #[test]
    fn apply_archive_skips_data_and_renames_exe() {
        let temp_dir = std::env::temp_dir().join(format!(
            "emr-portable-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&temp_dir).unwrap();
        let target_dir = &temp_dir;
        let current_exe = target_dir.join("app.exe");
        fs::write(&current_exe, b"old-binary").unwrap();

        let data_dir = target_dir.join("data");
        fs::create_dir_all(&data_dir).unwrap();
        let user_db = data_dir.join("emr.sqlite");
        fs::write(&user_db, b"user-database-content").unwrap();

        // Create in-memory zip containing new app.exe and a data/emr.sqlite attempt
        let mut zip_buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(Cursor::new(&mut zip_buf));
            zip.start_file("app.exe", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"new-binary").unwrap();
            zip.start_file("data/emr.sqlite", SimpleFileOptions::default())
                .unwrap();
            zip.write_all(b"overwritten-database").unwrap();
            zip.finish().unwrap();
        }

        apply_portable_archive(&zip_buf, target_dir, &current_exe).unwrap();

        // Verify exe updated
        assert_eq!(fs::read(&current_exe).unwrap(), b"new-binary");
        // Verify .old exe created
        assert_eq!(
            fs::read(target_dir.join("app.exe.old")).unwrap(),
            b"old-binary"
        );
        // Verify user data untouched!
        assert_eq!(fs::read(&user_db).unwrap(), b"user-database-content");

        // Verify cleanup
        cleanup_old_executables(target_dir);
        assert!(!target_dir.join("app.exe.old").exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
