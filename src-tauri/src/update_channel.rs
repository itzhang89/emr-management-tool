//! Which release channel an in-app update check reads, shared by the installer
//! and portable updaters.
//!
//! The channel is a *preference*, not a build identity: a stable install may opt
//! into betas, and a beta install may fall back to stable. The build's own
//! channel (`EMR_APP_CHANNEL`) only decides whether it may update at all — see
//! [`build_can_update`].

use crate::error::{AppError, AppResult};

/// Rolling release holding the installer manifest for betas. The stable
/// installer endpoints live in `tauri.conf.json` instead, so a beta URL is the
/// only one this module has to own.
pub const BETA_INSTALLER_MANIFEST: &str =
    "https://github.com/itzhang89/emr-management-tool/releases/download/beta-channel/latest.json";

/// Portable manifests. Stable keeps the URL the portable updater has always
/// embedded; beta mirrors it on its own rolling release.
pub const STABLE_PORTABLE_MANIFEST: &str =
    "https://github.com/itzhang89/emr-management-tool/releases/download/stable-channel-portable/portable-latest.json";
pub const BETA_PORTABLE_MANIFEST: &str =
    "https://github.com/itzhang89/emr-management-tool/releases/download/beta-channel-portable/portable-latest.json";

/// Every manifest above must stay under this base: the portable updater's
/// `is_allowed_portable_asset_url` only accepts downloads from it.
#[cfg(test)]
const RELEASES_BASE: &str = "https://github.com/itzhang89/emr-management-tool/releases/";

/// A channel an update check may read. Parsed through an allow-list because it
/// selects a URL that the app will then download and execute.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateChannel {
    Stable,
    Beta,
}

impl UpdateChannel {
    pub fn parse(raw: &str) -> AppResult<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            // An absent channel means the caller has no preference yet.
            "" | "stable" => Ok(Self::Stable),
            "beta" => Ok(Self::Beta),
            other => Err(AppError::validation(format!(
                "Unknown update channel \"{other}\". Expected \"stable\" or \"beta\"."
            ))),
        }
    }

    /// Name used in user-facing error text.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stable => "stable",
            Self::Beta => "beta",
        }
    }

    /// Manifest the installer updater must be pointed at, or `None` to keep the
    /// endpoints declared in `tauri.conf.json` (stable, including its fallback).
    pub fn installer_manifest(self) -> Option<&'static str> {
        match self {
            Self::Stable => None,
            Self::Beta => Some(BETA_INSTALLER_MANIFEST),
        }
    }

    pub fn portable_manifest(self) -> &'static str {
        match self {
            Self::Stable => STABLE_PORTABLE_MANIFEST,
            Self::Beta => BETA_PORTABLE_MANIFEST,
        }
    }
}

/// Whether this build may replace itself with a downloaded package.
///
/// `development` builds use the Dev product name, the Dev bundle identifier and
/// the local credential store, while every published package carries the stable
/// identity — applying one would leave the app in a mixed state, so those builds
/// never update. `beta` builds are release-profile packages on the stable
/// identity, so they update like stable ones do.
pub fn build_can_update() -> bool {
    matches!(
        option_env!("EMR_APP_CHANNEL").unwrap_or("stable"),
        "stable" | "beta"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_known_channels_and_defaults_to_stable() {
        assert_eq!(UpdateChannel::parse("stable").unwrap(), UpdateChannel::Stable);
        assert_eq!(UpdateChannel::parse("beta").unwrap(), UpdateChannel::Beta);
        assert_eq!(UpdateChannel::parse(" BETA ").unwrap(), UpdateChannel::Beta);
        assert_eq!(UpdateChannel::parse("").unwrap(), UpdateChannel::Stable);
    }

    #[test]
    fn rejects_unknown_channels_instead_of_building_a_url() {
        let error = UpdateChannel::parse("../../evil").expect_err("unknown channel");
        assert!(error.message.contains("Unknown update channel"));
    }

    #[test]
    fn stable_keeps_configured_installer_endpoints() {
        assert!(UpdateChannel::Stable.installer_manifest().is_none());
        assert_eq!(
            UpdateChannel::Beta.installer_manifest(),
            Some(BETA_INSTALLER_MANIFEST)
        );
    }

    #[test]
    fn channels_point_at_separate_portable_manifests() {
        assert_ne!(
            UpdateChannel::Stable.portable_manifest(),
            UpdateChannel::Beta.portable_manifest()
        );
        assert!(UpdateChannel::Beta.portable_manifest().contains("beta-channel-portable"));
    }

    #[test]
    fn manifests_stay_under_the_releases_base() {
        for manifest in [
            BETA_INSTALLER_MANIFEST,
            STABLE_PORTABLE_MANIFEST,
            BETA_PORTABLE_MANIFEST,
        ] {
            assert!(manifest.starts_with(RELEASES_BASE), "{manifest}");
        }
    }
}
