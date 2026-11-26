//! The Opencord app: a native window around orbital.monster, plus what a browser tab can't do —
//! real notifications, ringing that grabs your attention, vibration, camera and mic without prompts,
//! a tray icon that keeps you online, and self-updates.

mod media;
#[cfg(desktop)]
mod tray;
#[cfg(desktop)]
mod update;

#[cfg(desktop)]
use tauri::Manager;
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// The site the app shows. Links anywhere else open in the normal browser.
pub const SITE: &str = "https://orbital.monster";

fn is_ours(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "tauri" | "asset" | "about" | "data" | "blob")
        || matches!(url.host_str(), Some("orbital.monster" | "www.orbital.monster" | "tauri.localhost" | "localhost"))
        || is_embed(url)
}

/// WebKitGTK asks the navigation handler about iframes too, so the YouTube player's own pages must be allowed
/// or the video player breaks inside the app.
fn is_embed(url: &tauri::Url) -> bool {
    url.path().starts_with("/embed/")
        && matches!(url.host_str(), Some("www.youtube-nocookie.com" | "www.youtube.com" | "youtube.com"))
}

/// Where the window opens: the offline-aware shell page, which then loads the live site.
/// Dev builds can open a local server instead: OPENCORD_URL=http://localhost:3000 npm run dev
fn start_url() -> WebviewUrl {
    #[cfg(debug_assertions)]
    if let Some(url) = std::env::var("OPENCORD_URL").ok().and_then(|u| u.parse().ok()) {
        return WebviewUrl::External(url);
    }
    WebviewUrl::App("index.html".into())
}

/// Brings the window forward and flashes the taskbar: used for calls and mentions.
#[tauri::command]
fn attention(app: tauri::AppHandle, focus: bool) {
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.request_user_attention(Some(tauri::UserAttentionType::Critical));
        if focus {
            let _ = window.set_focus();
        }
    }
    #[cfg(mobile)]
    let _ = (app, focus);
}

/// What the page needs to know about the app it's running in.
#[tauri::command]
fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({
        "version": app.package_info().version.to_string(),
        "platform": std::env::consts::OS,
    })
}

/// Android sorts notifications into channels the user can tune in system settings.
/// Calls ring loudly and vibrate; messages pop up with the normal sound.
#[cfg(mobile)]
fn create_notification_channels(app: &tauri::AppHandle) {
    use tauri_plugin_notification::{Channel, Importance, NotificationExt};
    let channels = [
        Channel::builder("calls", "Calls").description("Someone is calling you").importance(Importance::High).vibration(true).build(),
        Channel::builder("messages", "Messages").description("DMs and mentions").importance(Importance::High).vibration(true).build(),
    ];
    for channel in channels {
        let _ = app.notification().create_channel(channel);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // A second launch just shows the window that's already running.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _, _| tray::show(app)))
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_haptics::init());

    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            attention,
            app_info,
            #[cfg(desktop)]
            update::pending_update,
            #[cfg(desktop)]
            update::install_update,
        ])
        .setup(|app| {
            // Dev builds let a local server use the app's features too (never in release builds).
            #[cfg(debug_assertions)]
            app.add_capability(include_str!("../dev-capability.json"))?;
            let handle = app.handle().clone();
            let window = WebviewWindowBuilder::new(app, "main", start_url())
                .on_navigation(move |url| {
                    if is_ours(url) {
                        return true;
                    }
                    use tauri_plugin_opener::OpenerExt;
                    let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                    false
                });
            #[cfg(desktop)]
            let window = window
                .title("Opencord")
                // No system title bar: the page draws its own window buttons in its headers.
                .decorations(false)
                .shadow(true)
                // See-through, so the page can round the window's corners.
                .transparent(true)
                .background_color(tauri::window::Color(0, 0, 0, 0))
                .inner_size(1200.0, 800.0)
                .min_inner_size(380.0, 500.0);
            let window = window.build()?;
            media::allow_camera_and_mic(&window);

            #[cfg(mobile)]
            create_notification_channels(app.handle());
            #[cfg(desktop)]
            {
                tray::create(app)?;
                update::watch(app.handle().clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Opencord");
}
