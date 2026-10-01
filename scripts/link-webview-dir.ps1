# scripts/link-webview-dir.ps1
# ---------------------------------------------------------------------------
# Redirect NoteApp's WebView2 profile to a writable folder using a directory junction.
#
# WHY THIS EXISTS (2026-09-30):
#   On this machine something in the file-system filter stack denies noteapp.exe writes to
#   %LOCALAPPDATA%\<identifier>, while the very same path stays writable for other
#   processes (verified) and a junction target is writable for the app. Without a writable
#   profile the app cannot start at all: Tauri fails while creating the window/webview with
#   "Failed to setup app: access denied (os error 5)" and the window just flashes and
#   closes. Pointing the profile at a writable folder makes it start again.
#
# What it does:
#   1. ensures the target folder exists (default: <repo>\.local-webview);
#   2. if EBWebView is already a junction, reports it and stops (nothing to do);
#   3. if EBWebView is a normal folder it must be EMPTY - otherwise the script stops and
#      tells you, so a real profile is never thrown away silently;
#   4. creates the junction and verifies it (attributes + a write through the link).
#
# Undo (back to a normal folder):
#   Remove-Item "<link>" -Force            # removes the junction, not the target
#   New-Item -ItemType Directory "<link>"
#
# Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/link-webview-dir.ps1
#         optional: -Target <dir>   -LinkPath <path>   (used by tests)
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads .ps1 as ANSI when there is
#       no BOM, so non-ASCII text can break parsing (same rule as setup.ps1).
# ---------------------------------------------------------------------------
param(
  [string]$Target = '',
  [string]$LinkPath = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not $Target) { $Target = Join-Path $root '.local-webview' }

# Read the bundle identifier without ConvertFrom-Json: the file is UTF-8 and Windows
# PowerShell 5.1 would read it as ANSI, which breaks parsing on non-ASCII content.
$identifier = 'com.noteapp.desktop'
$confPath = Join-Path $root 'src-tauri\tauri.conf.json'
if (Test-Path $confPath) {
  $raw = [System.IO.File]::ReadAllText($confPath, [System.Text.Encoding]::UTF8)
  if ($raw -match '"identifier"\s*:\s*"([^"]+)"') { $identifier = $Matches[1] }
}

if (-not $LinkPath) { $LinkPath = Join-Path $env:LOCALAPPDATA (Join-Path $identifier 'EBWebView') }

Write-Host "target   : $Target"
Write-Host "link     : $LinkPath"

if (-not (Test-Path $Target)) {
  New-Item -ItemType Directory -Path $Target -Force | Out-Null
  Write-Host "[OK] created the target folder" -ForegroundColor Green
}

$parent = Split-Path -Parent $LinkPath
if (-not (Test-Path $parent)) {
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
  Write-Host "[OK] created $parent" -ForegroundColor Green
}

if (Test-Path $LinkPath) {
  $item = Get-Item -LiteralPath $LinkPath -Force
  if ($item.Attributes -match 'ReparsePoint') {
    Write-Host "[OK] already a junction -> $($item.Target)" -ForegroundColor Green
    Write-Host "     nothing to do."
    exit 0
  }
  $children = @(Get-ChildItem -LiteralPath $LinkPath -Force -ErrorAction SilentlyContinue)
  if ($children.Count -gt 0) {
    Write-Host "[ERROR] $LinkPath is a normal folder with $($children.Count) entries." -ForegroundColor Red
    Write-Host "        Refusing to delete a real WebView2 profile." -ForegroundColor Yellow
    Write-Host "        Empty it yourself, then re-run this script." -ForegroundColor Yellow
    exit 1
  }
  Remove-Item -LiteralPath $LinkPath -Force
  Write-Host "[OK] removed the empty folder that was in the way"
}

cmd /c "mklink /J `"$LinkPath`" `"$Target`"" | Out-Null

$check = Get-Item -LiteralPath $LinkPath -Force -ErrorAction SilentlyContinue
if (-not $check -or $check.Attributes -notmatch 'ReparsePoint') {
  Write-Host "[ERROR] verification failed: the junction was not created." -ForegroundColor Red
  exit 1
}

try {
  $probe = Join-Path $LinkPath '.link-probe'
  [System.IO.File]::WriteAllText($probe, 'ok')
  Remove-Item -LiteralPath $probe -Force
} catch {
  Write-Host "[ERROR] the link exists but writing through it failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-Host "[OK] junction created and verified: $LinkPath -> $($check.Target)" -ForegroundColor Green
Write-Host "     NoteApp can now keep its webview profile in a writable place."
Write-Host "     Undo:  Remove-Item `"$LinkPath`" -Force;  New-Item -ItemType Directory `"$LinkPath`""
