fn main() {
    println!("cargo:rerun-if-env-changed=VITE_APP_CHANNEL");
    println!("cargo:rerun-if-env-changed=RELEASE_CHANNEL");

    let channel = std::env::var("VITE_APP_CHANNEL")
        .or_else(|_| std::env::var("RELEASE_CHANNEL"))
        .unwrap_or_else(|_| "stable".to_string());
    println!("cargo:rustc-env=EMR_APP_CHANNEL={channel}");

    tauri_build::build();
}
