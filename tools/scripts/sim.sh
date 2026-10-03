#!/bin/bash
# iOS Simulator helper — one dependable path for building, running and inspecting the iOS shell.
# Uses only Apple's own tools (xcodebuild / simctl), which keep working when the Claude Desktop
# simulator pane's screen capture crash-loops ("iOS Simulator is restarting after a crash").
#
#   tools/scripts/sim.sh build            stage web assets, cap sync, ad-hoc signed simulator build
#   tools/scripts/sim.sh run              boot the device, install + launch the last build
#   tools/scripts/sim.sh shot [file]      screenshot (default /tmp/sim.png) — read it with the Read tool
#   tools/scripts/sim.sh media FILE...    add photos/videos to the simulator's Photos library
#   tools/scripts/sim.sh url URL          open a URL / deep link (e.g. chromasmith://import)
#   tools/scripts/sim.sh logs [secs]      recent app + WebContent log lines
#   tools/scripts/sim.sh reset            shut everything down and restart CoreSimulator (use after a crash)
#
# ⚠️ The simulator build MUST be ad-hoc signed. An unsigned build (CODE_SIGNING_ALLOWED=NO) installs and
# launches but the web view never loads (blank dark screen, no console output). See docs/ios-shell.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_ID="com.tareq.chromasmith"
DD="${SIM_DERIVED:-/tmp/csbuild}"
APP="$DD/Build/Products/Debug-iphonesimulator/App.app"
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8   # CocoaPods crashes without a UTF-8 locale

udid() {
  if [ -n "${SIM_UDID:-}" ]; then echo "$SIM_UDID"; return; fi
  # Prefer an already-booted device, else the first "iPhone 17 Pro" on the newest runtime.
  local b; b=$(xcrun simctl list devices booted | grep -Eo '[0-9A-F-]{36}' | head -1 || true)
  if [ -n "$b" ]; then echo "$b"; return; fi
  xcrun simctl list devices available | grep -E "iPhone 17 Pro \(" | tail -1 | grep -Eo '[0-9A-F-]{36}'
}
ensure_booted() {
  local u; u=$(udid)
  xcrun simctl list devices | grep "$u" | grep -q Booted || xcrun simctl boot "$u"
  xcrun simctl bootstatus "$u" -b >/dev/null
  echo "$u"
}

case "${1:-}" in
  build)
    cd "$ROOT" && ./build-ios.sh >/dev/null && npx cap sync ios | tail -1
    cd "$ROOT/ios/App"
    xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator \
      -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DD" \
      CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=YES CODE_SIGNING_ALLOWED=YES CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= \
      build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
    # cap sync rewrites the Podfile and creates Podfile.lock — neither belongs in git.
    cd "$ROOT" && git checkout -q ios/App/Podfile 2>/dev/null || true; rm -f ios/App/Podfile.lock
    ;;
  run)
    u=$(ensure_booted)
    xcrun simctl terminate "$u" "$APP_ID" 2>/dev/null || true
    xcrun simctl install "$u" "$APP"
    xcrun simctl launch "$u" "$APP_ID"
    ;;
  shot)
    xcrun simctl io "$(udid)" screenshot "${2:-/tmp/sim.png}" 2>&1 | tail -1
    ;;
  media)
    shift; xcrun simctl addmedia "$(ensure_booted)" "$@"
    ;;
  url)
    xcrun simctl openurl "$(ensure_booted)" "$2"
    ;;
  logs)
    xcrun simctl spawn "$(udid)" log show --last "${2:-2}m" --style compact \
      --predicate 'process == "App" OR process == "ShareExt" OR process == "com.apple.WebKit.WebContent"' 2>/dev/null \
      | grep -viE "SecWarning|BoardServices|containermanager|AppSSO|launch_measurement|RunningBoard|CoreAnalytics" | tail -60
    ;;
  reset)
    xcrun simctl shutdown all || true
    killall Simulator 2>/dev/null || true
    killall -9 com.apple.CoreSimulator.CoreSimulatorService 2>/dev/null || true
    sleep 3; xcrun simctl list devices booted
    ;;
  *)
    sed -n '2,15p' "$0"; exit 1;;
esac
