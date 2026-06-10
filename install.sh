#!/usr/bin/env bash
set -euo pipefail

REPO="flashbots/decker"
BIN="decker"
API="https://api.github.com/repos/${REPO}/releases/latest"

OS="$(uname | tr '[:upper:]' '[:lower:]')"
case "$OS" in
  linux|darwin) ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

if [ -n "${VERSION:-}" ]; then
  TAG="${VERSION#v}"
  TAG="v${TAG}"
  echo "Checking version: $TAG"
  if ! curl -sSfL "https://api.github.com/repos/${REPO}/releases/tags/${TAG}" > /dev/null 2>&1; then
    echo "Error: version '${TAG}' not found. Check available releases at https://github.com/${REPO}/releases"
    exit 1
  fi
else
  echo "Fetching latest release..."
  TAG=$(curl -sSfL "$API" | sed -n 's/.*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n1)
  if [ -z "$TAG" ]; then
    echo "Error: could not determine latest release tag"
    exit 1
  fi
  echo "Latest version: $TAG"
fi

ASSET="${BIN}-${OS}-${ARCH}"
URL="https://github.com/${REPO}/releases/download/${TAG}/${ASSET}"

echo "Downloading $ASSET..."
curl -sSfL "$URL" -o "$ASSET"

chmod +x "$ASSET"
echo "Installing to /usr/local/bin..."
sudo mv "$ASSET" /usr/local/bin/${BIN}

echo "✅ Installed $BIN $TAG for ${OS}-${ARCH}"
