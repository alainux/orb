.PHONY: all test lint fmt clean run build dist release version

GO ?= go
GOFLAGS ?= -gcflags=all=-N -l
BIN := orb
SRC := $(shell find . -name '*.go' -not -path './.git/*')

# Version injected via ldflags; override with VERSION=vX.Y.Z (B-3 / AC-16.4).
VERSION ?= dev

# Build a single static binary with PortAudio statically linked (R16).
# Delegates to the portable static-link script so the artifact has no runtime
# dependency on a system libportaudio (AC-16.1, AC-16.5).
build:
	@VERSION=$(VERSION) scripts/build-static.sh

# Build the full multi-platform matrix into dist/ (AC-16.3).
dist:
	@VERSION=$(VERSION) scripts/build-release.sh

# Run unit tests.
test:
	$(GO) test -v -count=1 ./...

# Fast test (no cache).
test-fast:
	$(GO) test -count=1 ./...

# Lint (requires golangci-lint).
lint:
	golangci-lint run

# Format source files.
fmt:
	gofmt -w -s $(SRC)

# Run the binary with default config.
run: build
	./$(BIN)

# Clean build artifacts.
clean:
	rm -f $(BIN)
	rm -rf dist .deps
	$(GO) clean

# Quick smoke test: build + run + verify output.
smoke: build
	@echo "--- smoke: default run ---"
	./$(BIN) --no-visual 2>&1 | head -n 20 || true
	@echo "--- smoke: static-link check ---"
	@echo "built via scripts/build-static.sh (see rpt file)"

# Print the ldflags-injected version.
version:
	@echo $(VERSION)

all: fmt lint test build