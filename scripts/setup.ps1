# NoteApp Windows desktop one-click build (Tauri 2)
# Run from a NORMAL terminal that can reach static.rust-lang.org / crates.io / github.com.
#   powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
# or:  npm run desktop:setup
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

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

# MSVC build tools presence (tauri on Windows needs cl.exe; Visual Studio 2022 Build Tools)
$cl = Get-Command cl -ErrorAction SilentlyContinue
if (-not $cl) {
    Warn "cl.exe not on PATH - Visual Studio (MSVC) workload required for Rust on Windows."
    Warn "Install 'Desktop development with C++' via Visual Studio Installer, or VS Build Tools."
}

# 3) Root npm deps (@tauri-apps/cli) + web deps (@tauri-apps/api / vite / svelte)
Write-Host "Installing npm dependencies (root + web)..." -ForegroundColor Cyan
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "root npm install failed" }
npm --prefix web install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "web npm install failed" }
Pass "npm dependencies ready"

# 4) Frontend build (vite -> web/dist) then Tauri bundle (exe + msi/nsis)
Write-Host "Building desktop app (first cargo run downloads crates, may take a while)..." -ForegroundColor Cyan
npm run desktop:build
if ($LASTEXITCODE -ne 0) { throw "tauri build failed - see messages above" }

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
Write-Host "Notes live under %APPDATA%\com.noteapp.desktop\notes\ (<id>.md per note)." -ForegroundColor Cyan
