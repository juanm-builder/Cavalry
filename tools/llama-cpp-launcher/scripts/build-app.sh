#!/bin/zsh
# Builds the optional launcher bundle under this tool's ignored dist directory.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
APP_NAME="Cavalry LlamaCPP"
APP_DIR="$ROOT_DIR/dist/$APP_NAME.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"
APP_EXECUTABLE="$MACOS_DIR/launcher"

mkdir -p "$ROOT_DIR/dist"
rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RESOURCES_DIR"

cp "$ROOT_DIR/scripts/launch-llama-webui.sh" "$RESOURCES_DIR/launch-llama-webui.sh"
chmod +x "$RESOURCES_DIR/launch-llama-webui.sh"

cat > "$CONTENTS_DIR/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleExecutable</key>
  <string>launcher</string>
  <key>CFBundleIdentifier</key>
  <string>com.juanmbuilder.cavalry.llamacpp</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Cavalry LlamaCPP</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
</dict>
</plist>
EOF

cat > "$APP_EXECUTABLE" <<'EOF'
#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
RESOURCE_SCRIPT="$SCRIPT_DIR/../Resources/launch-llama-webui.sh"

if [[ ! -x "$RESOURCE_SCRIPT" ]]; then
  echo "Missing launcher resource: $RESOURCE_SCRIPT" >&2
  exit 1
fi

/usr/bin/osascript - "$RESOURCE_SCRIPT" <<'APPLESCRIPT'
on run argv
  set scriptPath to item 1 of argv
  set selectedAction to "Launch Cavalry Advisor Server"

  try
    set actionDialog to display dialog "Choose an action for Cavalry LlamaCPP." buttons {"Cancel", "Manage Cache", "Launch Cavalry Advisor Server"} default button "Launch Cavalry Advisor Server"
    set selectedAction to button returned of actionDialog
  on error number -128
    return
  end try

  if selectedAction is "Cancel" then
    return
  end if

  set commandLine to "/bin/zsh " & quoted form of scriptPath
  if selectedAction is "Manage Cache" then
    set commandLine to commandLine & " --cache-menu"
  end if

  tell application "Terminal"
    activate
    do script commandLine
  end tell
end run
APPLESCRIPT
EOF

chmod +x "$APP_EXECUTABLE"

print -- "Built app bundle at: $APP_DIR"
