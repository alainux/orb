#!/usr/bin/env bash
#
# build-static.sh — build a SINGLE `orb` binary with PortAudio statically linked.
#
# This is the "portable static-link" script (spec R16, AC-16.1 / AC-16.5). It
# guarantees the artifact has NO runtime dependency on a system libportaudio
# (.dylib / .so) — PortAudio is linked as a static archive — so the binary runs
# on any matching distro/mac without extra package installs.
#
# Usage:
#   scripts/build-static.sh                 # host OS/ARCH -> ./orb
#   scripts/build-static.sh darwin arm64
#   scripts/build-static.sh darwin amd64
#   scripts/build-static.sh linux amd64
#   scripts/build-static.sh linux arm64
#
# NOTE on "static": macOS requires the system audio frameworks to link
# dynamically (unavoidable, and the standard meaning of "static PortAudio");
# libportaudio itself is linked as a static archive. On Linux the release
# binary is fully static (musl-free, glibc-static, ld -static).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ----- config ----------------------------------------------------------------
PA_VERSION="${PA_VERSION:-19.7.0}"
PA_TARBALL="https://github.com/PortAudio/portaudio/archive/refs/tags/v${PA_VERSION}.tar.gz"
VERSION="${VERSION:-v0.1.0}"
X='-s -w'
VFLAG="-X main.buildVersion=${VERSION}"

GOOS_TARGET="${1:-$(go env GOOS)}"
GOARCH_TARGET="${2:-$(go env GOARCH)}"
GOARCH_TARGET="${GOARCH_TARGET:-$(go env GOARCH)}"

case "$GOOS_TARGET" in
  linux|darwin) ;;
  *) echo "orb-build: unsupported target os '$GOOS_TARGET' (linux|darwin)" >&2; exit 1 ;;
esac

if [[ "$GOOS_TARGET" == "$(go env GOOS)" && "$GOARCH_TARGET" == "$(go env GOARCH)" ]]; then
    OUT="orb"
else
    OUT="orb-${GOOS_TARGET}-${GOARCH_TARGET}"
fi
mkdir -p dist

note() { printf '\033[1;36m[orb]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[orb]\033[0m ERROR: %s\n' "$*" >&2; exit 1; }

# ----- Linux: fully static via docker ----------------------------------------
build_linux() {
    local arch="$1"
    note "building static Linux ($arch) binary in a container"
    docker build --platform "linux/${arch}" \
        --target dist \
        --output "type=local,dest=dist" \
        --build-arg "VERSION=${VERSION}" \
        -t "orb-linux-${arch}" \
        -f docker/linux.Dockerfile .
    mv dist/orb "dist/${OUT}"   # name it darwin-style (glob for release)
    note "static Linux binary: dist/${OUT}"
}

# ----- macOS: static libportaudio.a, frameworks stay dynamic ------------------
# Produce a pkg-config spec that resolves -lportaudio to a static archive only,
# so the Go (gordonklaus) binding links the .a and never a .dylib.
static_pc() {
    local libdir="$1"
    local pc="$libdir/portaudio-2.0.pc"
    local inc
    inc="$(brew --prefix portaudio)/include"
    cat > "$pc" <<EOF
prefix=
libdir=$libdir
includedir=$inc
Name: PortAudio
Description: static PortAudio for orb
Version: $PA_VERSION
Libs: -L\${libdir} -lportaudio -framework CoreAudio -framework AudioToolbox -framework AudioUnit -framework CoreFoundation -framework CoreServices
Libs.private: -framework CoreAudio -framework AudioToolbox -framework AudioUnit -framework CoreFoundation -framework CoreServices
Cflags: -I\${includedir}
EOF
    printf '%s\n' "$pc"
}

build_darwin() {
    local arch="$1"
    local pa libpa work pc libdir
    pa="$(brew --prefix portaudio 2>/dev/null)" \
        || die 'Homebrew PortAudio required; run: brew install portaudio'
    [[ -f "$pa/include/portaudio.h" ]] || die "PortAudio headers not found under $pa"

    if [[ "$arch" == amd64 && "$(uname -m)" == arm64 ]]; then
        libdir="$ROOT/.deps/pa-${PA_VERSION}-x86_64"
        mkdir -p "$libdir"
        if [[ ! -f "$libdir/libportaudio.a" ]]; then
            note "cross-building x86_64 static portaudio"
            build_darwin_x86_32 "$libdir"
        fi
        libpa="$libdir/libportaudio.a"
    else
        libdir="$ROOT/.deps/pa-${PA_VERSION}-$(uname -m)"
        mkdir -p "$libdir"
        libpa="$pa/lib/libportaudio.a"
        [[ -f "$libpa" ]] \
            || cp "$(brew --prefix portaudio)/lib/libportaudio.a" "$libdir/libportaudio.a" 2>/dev/null \
            || die "no static archive $libpa (brew install portaudio)"
        libpa="$libdir/libportaudio.a"
    fi

    pc="$(static_pc "$libdir")"
    note "linking static PortAudio (macOS/$arch): $libpa"
    PKG_CONFIG_LIBDIR="$libdir" \
    CGO_ENABLED=1 GOOS=darwin GOARCH="$arch" \
        CC="clang -arch $arch" \
        go build -trimpath -ldflags "$X $VFLAG" -o "dist/$OUT" .

    if command -v otool >/dev/null 2>&1; then
        if otool -L "dist/$OUT" | grep -qi 'libportaudio'; then
            die "dynamic libportaudio found in dist/$OUT — static link failed"
        fi
        note "confirmed: no dynamic libportaudio dependency in dist/$OUT"
    fi
    rm -f "$libdir/portaudio-2.0.pc"
    rm -rf ".deps"
}

# Cross-compile a static x86_64 libportaudio.a on an arm64 mac (per AC-16.3
# we must ship darwin/amd64 even from an ARM builder).
build_darwin_x86_32() {
    local cache="$1"
    local srcdir="$cache/src"
    [[ -d "$srcdir" ]] || {
        curl -fsSL "$PA_TARBALL" -o "$cache/pa.tar.gz"
        tar -C "$cache" -xzf "$cache/pa.tar.gz"
        mv "$cache"/portaudio-* "$srcdir"
    }
    cmake -S "$srcdir" -B "$cache/build" \
        -DCMAKE_OSX_ARCHITECTURES=x86_64 \
        -DCMAKE_POLICY_VERSION_MINIMUM=3.5 \
        -DBUILD_SHARED_LIBS=OFF \
        -DCMAKE_BUILD_TYPE=Release \
        -DENABLE_CXX=OFF >/dev/null
    cmake --build "$cache/build" --target portaudio_static --config Release >/dev/null
    find "$cache/build" -name 'libportaudio.a' -exec cp {} "$cache/libportaudio.a" \;
    [[ -f "$cache/libportaudio.a" ]] || die "x86_64 static portaudio build produced no .a"
}

case "$GOOS_TARGET" in
  linux)  build_linux "$GOARCH_TARGET" ;;
  darwin) build_darwin "$GOARCH_TARGET" ;;
esac

# Mirror the host build to ./orb for convenience.
if [[ -f "dist/orb" && ! -f "./orb" ]]; then
    cp dist/orb ./orb
fi

note "built: $([ "$OUT" = orb ] && echo './orb' || echo "dist/$OUT")"