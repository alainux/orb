# Formula for orb — installable from any tap as `brew install <tap>/orb`.
#
# This formula is tap-agnostic (AC-16.2): the `url` plus `sha256` pin a versioned
# GitHub release tarball, and PortAudio is our only native dependency, so the same
# file works on macOS and Linux (linuxbrew) with `brew install <tap>/orb`.
#
#   brew tap alainux/orb  &&  brew install alainux/orb/orb
#
# The PortAudio dependency is compiled by Homebrew; the Go build links it via the
# stock PortAudio bindings. The standalone release binaries on GitHub (assets) are
# instead statically linked per the build-static.sh/doc R16 AC-16.5.
class Orb < Formula
  desc "Full-duplex terminal workspace: talk to a live voice agent, dance with an animated orb"
  homepage "https://github.com/alainux/orb"
  url "https://github.com/alainux/orb/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "SHA256_PLACEHOLDER"
  license "MIT"

  head "https://github.com/alainux/orb.git", branch: "main"

  depends_on "go" => :build
  depends_on "portaudio"

  def install
    ENV["CGO_ENABLED"] = "1"
    system "go", "build", "-trimpath",
           "-mod", "readonly",
           "-ldflags", "-s -w -X main.buildVersion=#{version}",
           "-o", bin/"orb", "."
    # Precompressed man page optional; keep it minimal for now.
  end

  test do
    # Help renders without a mic; ensure the binary executes on the tap machine.
    assert_match "Usage: orb", shell_output("#{bin}/orb --help 2>&1", 0)
  end
end