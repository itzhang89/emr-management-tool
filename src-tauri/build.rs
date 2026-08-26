fn main() {
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

    // Tauri's build validates `bundle.resources` paths even during `tauri dev`.
    // The MCP server's dist/ is gitignored, so a fresh checkout breaks dev unless
    // we handle the missing directory here:
    // - exists           -> bundled as configured (release & dev unchanged)
    // - missing in dev   -> create a placeholder so the app boots; the MCP page
    //                       surfaces "run npm run mcp:build" until it is built
    // - missing in release -> hard error: never silently ship a bundle without MCP
    let mcp_dist = std::path::Path::new("../mcp/dist");
    println!("cargo:rerun-if-changed={}", mcp_dist.display());
    if !mcp_dist.exists() {
        if cfg!(debug_assertions) {
            eprintln!("warning: ../mcp/dist missing — creating placeholder so `tauri dev` can start (run `npm run mcp:build` to enable the built-in MCP server)");
            std::fs::create_dir_all(mcp_dist)
                .expect("failed to create placeholder ../mcp/dist");
        } else {
            panic!("../mcp/dist is missing — run `npm run mcp:build` before bundling a release build");
        }
    }

    tauri_build::build();
}
