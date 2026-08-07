import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commonGoCandidates, locateProjectRoot, platformKey, releaseAssetName } from "../src/audio/helper-resolution.js";

test("audio release assets match release workflow naming", () => {
  assert.equal(releaseAssetName("darwin", "arm64"), "orb-audio-darwin-arm64");
  assert.equal(releaseAssetName("darwin", "x64"), "orb-audio-darwin-x64");
  assert.equal(releaseAssetName("linux", "x64"), "orb-audio-linux-x64");
  assert.equal(releaseAssetName("win32", "x64"), "orb-audio-windows-x64.exe");
  assert.equal(platformKey("win32", "arm64"), "win32-arm64");
});

test("macOS source fallback can find Go outside Pi's inherited PATH", () => {
  const candidates = commonGoCandidates("darwin", {});
  assert.ok(candidates.includes("/opt/homebrew/bin/go"));
  assert.ok(candidates.includes("/usr/local/bin/go"));
  assert.ok(candidates.includes("/usr/local/go/bin/go"));
});

test("ORB_GO takes priority for developer source builds", () => {
  const candidates = commonGoCandidates("darwin", { ORB_GO: "/custom/go" });
  assert.equal(candidates[0], "/custom/go");
});


test("project root discovery works from both source and compiled layouts", async () => {
  const root = await mkdtemp(join(tmpdir(), "orb-root-"));
  try {
    await mkdir(join(root, "audio-helper"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "@alainux/orb" }), "utf8");
    await writeFile(join(root, "audio-helper", "go.mod"), "module example\n", "utf8");

    assert.equal(
      await locateProjectRoot(join(root, "src", "audio", "helper-resolution.ts")),
      root,
    );
    assert.equal(
      await locateProjectRoot(join(root, "dist", "src", "audio", "helper-resolution.js")),
      root,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
