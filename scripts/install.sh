#!/usr/bin/env sh
set -eu
REPO="https://github.com/alainux/orb"
BIN_DIR="${ORB_BIN_DIR:-$HOME/.local/bin}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "orb: missing required command: $1" >&2; exit 1; }; }
need pi
mkdir -p "$BIN_DIR"

echo "Installing Orb as a Pi package..."
pi install "$REPO"

cat > "$BIN_DIR/orb" <<'SHIM'
#!/usr/bin/env sh
ORB_AUTO_START=1 exec pi "$@"
SHIM
chmod +x "$BIN_DIR/orb"

echo "Installed Orb."
echo "Launcher: $BIN_DIR/orb"
case ":${PATH}:" in
  *":$BIN_DIR:"*) ;;
  *) echo "Add $BIN_DIR to PATH, then run: orb" ;;
esac
