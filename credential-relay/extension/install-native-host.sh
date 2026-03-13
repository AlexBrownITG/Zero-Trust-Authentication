#!/bin/bash
#
# Installs the native messaging host manifest for Chrome/Chromium.
# Usage: ./install-native-host.sh <chrome-extension-id>
#
# The extension ID is shown in chrome://extensions after loading
# the unpacked extension.

set -e

EXTENSION_ID="${1:?Usage: $0 <chrome-extension-id>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PATH="$SCRIPT_DIR/native-host/host.js"
HOST_NAME="com.credential_relay.agent"
MANIFEST_FILE="$HOST_NAME.json"

# Determine manifest install directory per platform
case "$(uname -s)" in
  Darwin)
    # macOS
    CHROME_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    CHROMIUM_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
    ;;
  Linux)
    CHROME_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    CHROMIUM_DIR="$HOME/.config/chromium/NativeMessagingHosts"
    ;;
  *)
    echo "Unsupported platform: $(uname -s)"
    echo "For Windows, see the README for registry-based installation."
    exit 1
    ;;
esac

# Write manifest
write_manifest() {
  local dir="$1"
  mkdir -p "$dir"
  cat > "$dir/$MANIFEST_FILE" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Credential Relay Agent Native Messaging Host",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF
  echo "Installed: $dir/$MANIFEST_FILE"
}

# Install for Chrome
write_manifest "$CHROME_DIR"

# Also install for Chromium if the directory exists
if [ -d "$(dirname "$CHROMIUM_DIR")" ]; then
  write_manifest "$CHROMIUM_DIR"
fi

# Make host executable
chmod +x "$HOST_PATH"

echo ""
echo "Native messaging host installed successfully!"
echo "Extension ID: $EXTENSION_ID"
echo "Host path: $HOST_PATH"
echo ""
echo "Make sure the agent is running before using the extension."
