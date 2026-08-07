$ErrorActionPreference = "Stop"
$repo = "https://github.com/alainux/orb"
if (-not (Get-Command pi -ErrorAction SilentlyContinue)) { throw "Pi is required. Install it from https://pi.dev first." }
Write-Host "Installing Orb as a Pi package..."
& pi install $repo
$bin = Join-Path $HOME "bin"
New-Item -ItemType Directory -Force -Path $bin | Out-Null
$cmd = Join-Path $bin "orb.cmd"
"@echo off`r`nset ORB_AUTO_START=1`r`npi %*`r`n" | Set-Content -Encoding Ascii $cmd
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (($userPath -split ";") -notcontains $bin) {
  [Environment]::SetEnvironmentVariable("Path", (($userPath.TrimEnd(";")) + ";" + $bin), "User")
  Write-Host "Added $bin to your user PATH. Open a new terminal before running orb."
}
Write-Host "Orb installed. Run: orb"
