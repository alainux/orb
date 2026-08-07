$ErrorActionPreference = "Stop"
$repo = "https://github.com/alainux/orb"

if (-not (Get-Command pi -ErrorAction SilentlyContinue)) {
  throw "Pi is required. Install it from https://pi.dev first."
}

Write-Host "Installing Orb as a Pi package..."
& pi install $repo
if ($LASTEXITCODE -ne 0) { throw "pi install failed with exit code $LASTEXITCODE" }

$bin = if ($env:ORB_BIN_DIR) { $env:ORB_BIN_DIR } else { Join-Path $HOME "bin" }
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$cmd = Join-Path $bin "orb.cmd"
"@echo off`r`nset ORB_AUTO_START=1`r`npi %*`r`n" | Set-Content -Encoding Ascii $cmd

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$parts = if ([string]::IsNullOrWhiteSpace($userPath)) { @() } else { $userPath -split ";" | Where-Object { $_ } }
if ($parts -notcontains $bin) {
  $nextPath = if ($parts.Count -eq 0) { $bin } else { ($parts + $bin) -join ";" }
  [Environment]::SetEnvironmentVariable("Path", $nextPath, "User")
  Write-Host "Added $bin to your user PATH. Open a new terminal before running orb."
}

Write-Host "Orb installed. Run: orb"
