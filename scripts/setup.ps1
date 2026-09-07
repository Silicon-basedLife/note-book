# NoteApp Windows desktop one-click build (Tauri 2)
# Run from a NORMAL terminal that can reach static.rust-lang.org / crates.io / github.com.
#   powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
# or:  npm run desktop:setup
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# 本机（用户级 .npmrc / 环境变量）配置了 npm 11 的 allow-scripts=["pnpm"]；
# npm 不允许项目级安装从该配置带入，会直接报 EALLOWSCRIPTS。清空后恢复常规安装行为。
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

# MSVC build tools: 通常无需把 cl.exe 加入 PATH —— rustup 会经 vswhere 自动发现 VS 的 MSVC。
# 仅当后续链接阶段出现 LNK 相关错误时，再用 “x64 Native Tools” 环境重跑本脚本。
$cl = Get-Command cl -ErrorAction SilentlyContinue
if (-not $cl) {
    Warn "cl.exe 不在 PATH 上（正常）。rustup 会自动检测 Visual Studio MSVC。"
    Warn "若 cargo 链接报 LNK 错误，请安装 '使用 C++ 的桌面开发' 工作负载后重试。"
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
