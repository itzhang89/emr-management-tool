//! Which release channel an in-app update check reads, shared by the installer
//! and portable updaters.
//!
//! The channel is a *preference*, not a build identity: a stable install may opt
//! into betas, and a beta install may fall back to stable. The build's own
//! channel (`EMR_APP_CHANNEL`) only decides whether it may update at all — see
//! [`build_can_update`].

use crate::error::{AppError, AppResult};

/// `owner/name` of the publishing repository, injected by `build.rs` from
/// `GITHUB_REPOSITORY` in CI and from `package.json`'s `repository` field for
/// local builds. Composing the update URLs from it keeps the repository address
/// out of the source entirely.
pub const REPO_SLUG: &str = env!("EMR_REPO_SLUG");

/// Rolling release holding each channel's installer manifest.
const STABLE_INSTALLER_RELEASE: &str = "stable-channel";
const BETA_INSTALLER_RELEASE: &str = "beta-channel";
/// Portable builds have their own rolling releases: they must never download an
/// installer package.
const STABLE_PORTABLE_RELEASE: &str = "stable-channel-portable";
const BETA_PORTABLE_RELEASE: &str = "beta-channel-portable";

/// URL of a manifest published as an asset of a rolling release.
pub fn release_asset(release: &str, file: &str) -> String {
    format!("https://github.com/{REPO_SLUG}/releases/download/{release}/{file}")
}

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

    /// Installer endpoints to hand the updater, in preference order.
    ///
    /// Stable keeps a second endpoint pointing at the newest release, where a
    /// tag build's manifest also lands. Beta deliberately has one: `latest/`
    /// resolves to the newest *published* release, so listing it there would let
    /// a beta check fall through to a stable manifest.
    pub fn installer_manifests(self) -> Vec<String> {
        match self {
            Self::Stable => vec![
                release_asset(STABLE_INSTALLER_RELEASE, "latest.json"),
                format!("https://github.com/{REPO_SLUG}/releases/latest/download/latest.json"),
            ],
            Self::Beta => vec![release_asset(BETA_INSTALLER_RELEASE, "latest.json")],
        }
    }

    /// Portable builds read their own releases so they can never download an
    /// installer package.
    pub fn portable_manifest(self) -> String {
        match self {
            Self::Stable => release_asset(STABLE_PORTABLE_RELEASE, "portable-latest.json"),
            Self::Beta => release_asset(BETA_PORTABLE_RELEASE, "portable-latest.json"),
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

    /// Every URL must be built from the injected slug, so a fork or a rename is
    /// a build-time input rather than a source edit.
    #[test]
    fn manifests_are_built_from_the_injected_repo_slug() {
        let base = format!("https://github.com/{REPO_SLUG}/releases/");
        for manifest in [
            UpdateChannel::Stable.installer_manifests(),
            UpdateChannel::Beta.installer_manifests(),
        ]
        .concat()
        {
            assert!(manifest.starts_with(&base), "{manifest}");
        }
        for channel in [UpdateChannel::Stable, UpdateChannel::Beta] {
            assert!(channel.portable_manifest().starts_with(&base));
        }
    }

    #[test]
    fn stable_offers_a_fallback_endpoint_and_beta_does_not() {
        let stable = UpdateChannel::Stable.installer_manifests();
        assert_eq!(stable.len(), 2);
        assert!(stable[0].ends_with("/stable-channel/latest.json"));
        assert!(stable[1].ends_with("/releases/latest/download/latest.json"));

        // `latest/` resolves to the newest published release, so a beta must not
        // list it: the check would fall through to a stable manifest.
        let beta = UpdateChannel::Beta.installer_manifests();
        assert_eq!(beta.len(), 1);
        assert!(beta[0].ends_with("/beta-channel/latest.json"));
    }

    #[test]
    fn channels_point_at_separate_portable_manifests() {
        assert!(UpdateChannel::Stable
            .portable_manifest()
            .ends_with("/stable-channel-portable/portable-latest.json"));
        assert!(UpdateChannel::Beta
            .portable_manifest()
            .ends_with("/beta-channel-portable/portable-latest.json"));
    }

    /// `build.rs` resolves the slug from `GITHUB_REPOSITORY` in CI and from
    /// `package.json` locally. Either way it must be a usable `owner/name`: an
    /// empty value would silently produce a `github.com//releases/...` URL.
    #[test]
    fn slug_has_owner_and_name() {
        let parts: Vec<&str> = REPO_SLUG.split('/').collect();
        assert_eq!(parts.len(), 2, "unexpected slug {REPO_SLUG}");
        assert!(parts.iter().all(|part| !part.trim().is_empty()), "{REPO_SLUG}");
    }
}
