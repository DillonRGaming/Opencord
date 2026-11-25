//! Self-updates on Linux and Windows: check at start and every few hours, download in the background,
//! then the page offers "Restart to update". Android gets its update prompt from the page instead.

use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

const EVERY: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Default)]
struct Ready(Mutex<Option<(Update, Vec<u8>)>>);

pub fn watch(app: AppHandle) {
    app.manage(Ready::default());
    tauri::async_runtime::spawn(async move {
        loop {
            if let Err(err) = fetch(&app).await {
                eprintln!("update check failed: {err}");
            }
            tokio::time::sleep(EVERY).await;
        }
    });
}

async fn fetch(app: &AppHandle) -> tauri_plugin_updater::Result<()> {
    if app.state::<Ready>().0.lock().unwrap().is_some() {
        return Ok(());
    }
    if let Some(update) = app.updater()?.check().await? {
        let bytes = update.download(|_, _| {}, || {}).await?;
        *app.state::<Ready>().0.lock().unwrap() = Some((update, bytes));
    }
    Ok(())
}

/// The version that's downloaded and waiting, if any.
#[tauri::command]
pub fn pending_update(app: AppHandle) -> Option<String> {
    app.state::<Ready>().0.lock().unwrap().as_ref().map(|(update, _)| update.version.clone())
}

/// Installs the waiting update and starts the new version.
#[tauri::command]
pub fn install_update(app: AppHandle) -> Result<(), String> {
    let Some((update, bytes)) = app.state::<Ready>().0.lock().unwrap().take() else {
        return Err("No update is waiting.".into());
    };
    update.install(bytes).map_err(|err| err.to_string())?;
    app.restart();
}
