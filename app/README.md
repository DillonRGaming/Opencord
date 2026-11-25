# Opencord app

The Linux, Windows and Android app. It's a small native shell ([Tauri 2](https://tauri.app)) that opens
orbital.monster, so the UI is always the live site. The shell adds what a browser tab can't do:

| | Linux | Windows | Android |
|---|---|---|---|
| System notifications | ✓ | ✓ | ✓ (Calls and Messages channels) |
| Calls ring: window jumps forward, taskbar flashes | ✓ | ✓ | — |
| Vibration for calls and mentions | — | — | ✓ |
| Camera and mic without a prompt every time | ✓ | ✓ | asks once (Android) |
| Keeps running in the tray when closed | ✓ | ✓ | — |
| Updates itself | ✓ | ✓ | offers the new APK |

The page talks to the shell through [`public/js/native.js`](../public/js/native.js). In a normal browser, the
same calls fall back to the web versions.

## Layout

- `shell/index.html`: the first page. It opens the live site, or says "can't reach Opencord" while you're offline.
- `src-tauri/src/lib.rs`: the window, the plugins and the app's commands.
- `src-tauri/src/media.rs`: lets the webview use the camera and mic.
- `src-tauri/src/tray.rs`: the tray icon, and close-to-tray.
- `src-tauri/src/update.rs`: background updates on desktop.
- `src-tauri/capabilities/`: what orbital.monster is allowed to ask the shell for.
- `src-tauri/gen/android/`: the Android project (permissions in `AndroidManifest.xml`).

## Run it locally

```bash
cd app && npm install
npm run dev            # desktop
npm run android:dev    # a phone plugged in, or an emulator
```

## Releasing

Push a version tag. GitHub Actions builds all three and publishes them as a
[release of this repo](https://github.com/DillonRGaming/Opencord/releases). Installed apps update from there.

```bash
git tag v0.2.0 && git push origin v0.2.0
```

### One-time setup

Add these secrets to the repo. The keys were made on your machine in `~/.tauri/`, so keep a backup:
if they're lost, installed apps can't update anymore.

```bash
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/opencord.key
base64 -w0 ~/.tauri/opencord-android.jks | gh secret set ANDROID_KEYSTORE
gh secret set ANDROID_KEYSTORE_PASSWORD < ~/.tauri/android-password
gh secret set ANDROID_KEY_ALIAS --body opencord
```
