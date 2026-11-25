fn main() {
    // The app's own commands, so the capability file can allow them for orbital.monster.
    let commands = &["attention", "app_info", "pending_update", "install_update"];
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(commands)))
        .expect("failed to run the Tauri build script");
}
