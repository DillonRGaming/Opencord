//! Calls need the camera and mic. The page only ever shows our own site, so the webview grants them
//! (and notifications) straight away instead of asking every time. Android asks once through the
//! system, which the webview's own permission handling already does.

use tauri::WebviewWindow;

#[cfg(target_os = "linux")]
pub fn allow_camera_and_mic(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| {
        use webkit2gtk::glib::prelude::*;
        use webkit2gtk::{PermissionRequestExt, SettingsExt, WebViewExt};
        let view = webview.inner();
        if let Some(settings) = WebViewExt::settings(&view) {
            settings.set_enable_media_stream(true);
            settings.set_enable_webrtc(true); // off by default in WebKitGTK: without it calls have no sound or video
            settings.set_enable_mediasource(true);
            settings.set_media_playback_requires_user_gesture(false);
        }
        view.connect_permission_request(|_, request| {
            let wanted = request.is::<webkit2gtk::UserMediaPermissionRequest>()
                || request.is::<webkit2gtk::NotificationPermissionRequest>()
                || request.is::<webkit2gtk::DeviceInfoPermissionRequest>();
            if wanted {
                request.allow();
            }
            wanted
        });
    });
}

#[cfg(windows)]
pub fn allow_camera_and_mic(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::*;
        use webview2_com::PermissionRequestedEventHandler;
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let handler = PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut kind)?;
            if [
                COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
                COREWEBVIEW2_PERMISSION_KIND_CAMERA,
                COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS,
                COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ,
            ]
            .contains(&kind)
            {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
            Ok(())
        }));
        let mut token = Default::default();
        let _ = core.add_PermissionRequested(&handler, &mut token);
    });
}

#[cfg(not(any(target_os = "linux", windows)))]
pub fn allow_camera_and_mic(_window: &WebviewWindow) {}
