fn main() {
    println!("cargo:rerun-if-env-changed=VITE_APP_CHANNEL");
    println!("cargo:rerun-if-env-changed=RELEASE_CHANNEL");
    println!("cargo:rerun-if-env-changed=EMR_CREDENTIAL_STORE");

    let channel = std::env::var("VITE_APP_CHANNEL")
        .or_else(|_| std::env::var("RELEASE_CHANNEL"))
        .unwrap_or_else(|_| "stable".to_string());
    println!("cargo:rustc-env=EMR_APP_CHANNEL={channel}");

    let credential_store =
        std::env::var("EMR_CREDENTIAL_STORE").unwrap_or_else(|_| "auto".to_string());
    println!("cargo:rustc-env=EMR_CREDENTIAL_STORE={credential_store}");

    tauri_build::build();
}
