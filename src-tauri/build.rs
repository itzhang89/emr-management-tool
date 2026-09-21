use std::path::Path;

/// `owner/name` of the repository that publishes this app, used to build the
/// update URLs. CI passes `GITHUB_REPOSITORY`, so a fork or a rename needs no
/// source edits; local builds read it from `package.json`'s `repository` field,
/// which keeps the declaration to exactly one place.
fn repo_slug() -> String {
    if let Ok(slug) = std::env::var("GITHUB_REPOSITORY") {
        let slug = slug.trim();
        if !slug.is_empty() {
            return slug.to_string();
        }
    }

    let package_json = Path::new("../package.json");
    let repository = std::fs::read_to_string(package_json)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|json| {
            json.get("repository")
                .and_then(|value| value.as_str().map(str::to_string))
        })
        .unwrap_or_default();

    let slug = repository
        .trim()
        .trim_end_matches('/')
        .trim_end_matches(".git")
        .rsplit("github.com/")
        .next()
        .filter(|candidate| candidate.contains('/'))
        .map(str::to_string)
        .unwrap_or_default();

    if slug.is_empty() {
        panic!(
            "Could not determine the repository slug. Set GITHUB_REPOSITORY, or add a GitHub \
             `repository` URL to package.json."
        );
    }
    slug
}

fn main() {
    println!("cargo:rerun-if-env-changed=GITHUB_REPOSITORY");
    println!("cargo:rerun-if-changed=../package.json");
    println!("cargo:rerun-if-env-changed=VITE_APP_CHANNEL");
    println!("cargo:rerun-if-env-changed=RELEASE_CHANNEL");
    println!("cargo:rerun-if-env-changed=EMR_CREDENTIAL_STORE");
    println!("cargo:rerun-if-env-changed=VITE_APP_DISTRIBUTION");
    println!("cargo:rerun-if-env-changed=VITE_APP_VERSION");
    println!("cargo:rerun-if-env-changed=RELEASE_VERSION");
    println!("cargo:rerun-if-env-changed=TAURI_UPDATER_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=EMR_UPDATER_PUBLIC_KEY");

    let channel = std::env::var("VITE_APP_CHANNEL")
        .or_else(|_| std::env::var("RELEASE_CHANNEL"))
        .unwrap_or_else(|_| "stable".to_string());
    println!("cargo:rustc-env=EMR_APP_CHANNEL={channel}");

    let credential_store =
        std::env::var("EMR_CREDENTIAL_STORE").unwrap_or_else(|_| "auto".to_string());
    println!("cargo:rustc-env=EMR_CREDENTIAL_STORE={credential_store}");

    let distribution = match std::env::var("VITE_APP_DISTRIBUTION") {
        Ok(value) if value == "portable" => "portable",
        _ => "installer",
    };
    println!("cargo:rustc-env=EMR_APP_DISTRIBUTION={distribution}");

    let version = std::env::var("VITE_APP_VERSION")
        .or_else(|_| std::env::var("RELEASE_VERSION"))
        .unwrap_or_else(|_| env!("CARGO_PKG_VERSION").to_string());
    println!("cargo:rustc-env=EMR_APP_VERSION={version}");

    let pubkey = std::env::var("TAURI_UPDATER_PUBLIC_KEY")
        .or_else(|_| std::env::var("EMR_UPDATER_PUBLIC_KEY"))
        .ok()
        .filter(|k| !k.trim().is_empty())
        .unwrap_or_else(|| {
            "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEI4MEI1NUUzRTE0NkM2RQpSV1J1YkJRK1hyV0FDOW05YjRsVHJEeURrcUt4VVJvMS9lck00Y1FqM2JLUmtxZDduL1hOYytVdAo=".to_string()
        });
    println!("cargo:rustc-env=EMR_UPDATER_PUBLIC_KEY={pubkey}");

    let repo = repo_slug();
    println!("cargo:rustc-env=EMR_REPO_SLUG={repo}");

    tauri_build::build();
}
