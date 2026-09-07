# NoteApp Windows desktop one-click build (Tauri 2)
# Run from a NORMAL terminal that can reach static.rust-lang.org / crates.io / github.com.
#   powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
# or:  npm run desktop:setup
# NOTE: keep this file pure ASCII (no non-ASCII chars) so Windows PowerShell 5.1
#       parses it correctly regardless of system codepage.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# This machine configures npm 11 "allow-scripts" at user level, which npm refuses
# for project-scoped installs (EALLOWSCRIPTS). Clearing the variable restores the
# regular install behaviour. (Env var beats package.json, so only this works.)
if ($env:npm_config_allow_scripts) {
    $env:npm_config_allow_scripts = ''
}

function Pass($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[!!] $msg" -ForegroundColor Yellow }

Write-Host "=== NoteApp desktop build ===" -ForegroundColor Cyan

# 1) Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js >= 24 not found. Install from https://nodejs.org/ then rerun."
}
Pass ("node " + (node --version))

# 2) Rust toolchain (cargo + rustc)
$hasCargo = [bool](Get-Command cargo -ErrorAction SilentlyContinue)
if (-not $hasCargo) {
    $hasRustup = [bool](Get-Command rustup -ErrorAction SilentlyContinue)
    if (-not $hasRustup) {
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            Warn "Installing Rust via winget (Rustup.Rustup)..."
            winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
        }
        if (-not (Get-Command rustup -ErrorAction SilentlyContinue)) {
            throw "rustup not installed. Please install manually from https://rustup.rs and rerun."
        }
    }
    Warn "Initializing default Rust toolchain (downloads ~200MB)..."
    rustup default stable
}
Pass ("cargo " + (cargo --version))

# MSVC is auto-detected by rustup via vswhere; cl.exe does NOT need to be on PATH.
# Only if cargo linking later fails with LNK errors, install the C++ workload.
$cl = Get-Command cl -ErrorAction SilentlyContinue
if (-not $cl) {
    Warn "cl.exe is not on PATH (expected). rustup will auto-detect Visual Studio MSVC."
    Warn "If cargo linking reports LNK errors later, install the 'Desktop development with C++' workload."
}

# 3) Root npm deps (@tauri-apps/cli) + web deps (@tauri-apps/api / vite / svelte)
Write-Host "Installing npm dependencies (root + web)..." -ForegroundColor Cyan
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "root npm install failed" }
npm --prefix web install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "web npm install failed" }
Pass "npm dependencies ready"

# 4) Build the runnable EXE first (no bundling: bundling downloads NSIS/WiX from
#    github.com, which this network refuses). If NOTEAPP_BUNDLE=1 and github is
#    reachable, also build MSI/NSIS installers afterwards.
Write-Host "Building desktop app (first cargo run downloads crates, may take a while)..." -ForegroundColor Cyan
npm run desktop:exe
if ($LASTEXITCODE -ne 0) { throw "tauri build failed - see messages above" }

if ($env:NOTEAPP_BUNDLE -eq '1') {
    Write-Host "Building installers (MSI/NSIS; needs github.com reachable)..." -ForegroundColor Cyan
    npm run desktop:build
    if ($LASTEXITCODE -ne 0) { Warn "Installer bundling failed (github unreachable?) - the EXE above is still usable." }
}

$exe = Join-Path $root 'src-tauri\target\release\NoteApp.exe'
$bundle = Join-Path $root 'src-tauri\target\release\bundle'
Write-Host "`n=== Done ===" -ForegroundColor Green
if (Test-Path $exe) { Write-Host "Run directly : $exe" -ForegroundColor Green }
if (Test-Path (Join-Path $bundle 'msi')) {
    Get-ChildItem (Join-Path $bundle 'msi') | ForEach-Object { Write-Host "Installer MSI : $($_.FullName)" -ForegroundColor Green }
}
if (Test-Path (Join-Path $bundle 'nsis')) {
    Get-ChildItem (Join-Path $bundle 'nsis') | ForEach-Object { Write-Host "Installer EXE : $($_.FullName)" -ForegroundColor Green }
}
Write-Host ""
Write-Host "No installers were built because github.com is unreachable from here." -ForegroundColor Yellow
Write-Host "To also build MSI/NSIS later (on a network that can reach github.com):" -ForegroundColor Cyan
Write-Host "    npm run desktop:build" -ForegroundColor Cyan
Write-Host "Notes live under %APPDATA%\com.noteapp.desktop\notes\ (<id>.md per note)." -ForegroundColor Cyan
