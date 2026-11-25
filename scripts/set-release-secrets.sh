#!/usr/bin/env bash
# Adds the app signing keys from ~/.tauri to this repo's GitHub secrets, so tagged releases build signed apps.
set -euo pipefail
cd "$(dirname "$0")/.."
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/opencord.key
base64 -w0 ~/.tauri/opencord-android.jks | gh secret set ANDROID_KEYSTORE
gh secret set ANDROID_KEYSTORE_PASSWORD < ~/.tauri/android-password
gh secret set ANDROID_KEY_ALIAS --body opencord
echo "Done: 4 secrets set."
