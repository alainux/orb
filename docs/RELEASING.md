# Releasing Orb

Orb releases are driven by Git tags.

## Before tagging

```bash
npm install --ignore-scripts
npm run check
npm run pack:check
```

Update `package.json` and `CHANGELOG.md`, then tag the same version:

```bash
git tag v0.5.3
git push origin v0.5.3
```

## What the release workflow does

The GitHub Actions release workflow:

1. builds the Go audio helper on Linux, macOS, and Windows runners (x64/arm64 where hosted runners are available),
2. runs the complete TypeScript and dependency-free Go test suite,
3. builds the production extension,
4. packs `@alainux/orb`,
5. creates SHA-256 checksums,
6. publishes a GitHub Release with the npm tarball and standalone audio helpers,
7. publishes to npm when the `NPM_TOKEN` repository secret is configured.

ARM runner jobs marked experimental do not block the primary x64/macOS release if a hosted preview environment is temporarily unavailable. Users without a matching prebuilt helper can still build the sidecar locally with Go and a C compiler.

The website deploys separately from `site/` through GitHub Pages whenever `main` changes.
