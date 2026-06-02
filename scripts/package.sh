#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
BUILD_DIR="$DIST_DIR/build"
cd "$ROOT_DIR"
VERSION="$(python3 -c 'import json; print(json.load(open("manifest.json"))["version"])' 2>/dev/null)"
PACKAGE_NAME="community-keeper-v${VERSION}.zip"
PACKAGE_PATH="$DIST_DIR/$PACKAGE_NAME"

if ! command -v zip >/dev/null 2>&1; then
  echo "zip command is required" >&2
  exit 1
fi

rm -rf "$BUILD_DIR" "$PACKAGE_PATH"
mkdir -p "$BUILD_DIR"

cp manifest.json background.js popup.html popup.css popup.js "$BUILD_DIR/"
cp -R icons platforms "$BUILD_DIR/"
rm -f "$BUILD_DIR/icons/icon-source.png"

(
  cd "$BUILD_DIR"
  zip -qr "$PACKAGE_PATH" .
)

rm -rf "$BUILD_DIR"
echo "Created $PACKAGE_PATH"
