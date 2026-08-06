#!/usr/bin/env bash
#
# build-release.sh — build the full multi-platform binary matrix for a release.
#
# Produces, under dist/, four statically-linked (PortAudio) binaries plus a
# checksums file:
#   orb-darwin-arm64   orb-darwin-amd64
#   orb-linux-arm64    orb-linux-amd64
#   SHA256SUMS
#
# Usage:
#   VERSION=v0.1.0 scripts/build-release.sh
#
# Linux targets are built fully static via docker/linux.Dockerfile (qemu
# emulation is used for linux/amd64 when the host is arm64). macOS targets link
# a static libportaudio; system audio frameworks remain dynamic.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${VERSION:-v0.1.0}"
SCRIPT="scripts/build-static.sh"
chmod +x "$SCRIPT"

echo "==> orb release build ${VERSION}"
rm -rf dist && mkdir -p dist

for target in \
    darwin-arm64 \
    darwin-amd64 \
    linux-amd64 \
    linux-arm64; do
  os="${target%-*}"; arch="${target#*-}"
  echo ""
  echo "==> $os/$arch"
  (cd "$ROOT" && VERSION="$VERSION" "$SCRIPT" "$os" "$arch")
  # The host build (darwin/arm64) is emitted as plain "orb"; normalize it.
  if [[ -f dist/orb && ! -f "dist/orb-${target}" ]]; then
    mv dist/orb "dist/orb-${os}-${arch}"
  fi
done

echo ""
echo "==> checksums"
(cd dist && shasum -a 256 orb-* | tee SHA256SUMS)
echo ""
echo "==> dist/"
ls -1 dist/