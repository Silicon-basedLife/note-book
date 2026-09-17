# scripts/release.ps1 - NoteApp one-shot release to GitHub.
# Run from a NORMAL terminal that can reach github.com (this sandbox cannot).
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release.ps1
# Options:
#   -Version 0.1.0     release version (default: read from src-tauri/tauri.conf.json)
#   -SkipTests         skip unit tests
#   -SkipBuild         skip tauri build (release assets then come from existing target dir)
#   -Draft             create the GitHub release as draft
# Notes:
#   * exports NOTEAPP_BUNDLE=1 before running to also build MSI/NSIS installers
#     (that step needs github.com reachable; otherwise only NoteApp.exe is released)
#   * requires `gh` CLI for automatic release creation; without it the script prints manual steps
param(
    [string]$Version = '',
    [switch]$SkipTests,
    [switch]$SkipBuild,
    [switch]$Draft
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m) { throw $m }

# 1) resolve version
if (-not $Version) {
    $conf = Get-Content 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json
    $Version = $conf.version
}
$tag = "v$Version"
Info "version: $Version  tag: $tag"

# 2) preflight
if (git status --porcelain) { Fail "working tree is not clean - commit or stash first" }
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'master') { Fail "current branch is '$branch', expected master" }
$remote = (git remote get-url origin).Trim()
Info "remote: $remote"

# 3) tests
if (-not $SkipTests) {
    Info "running unit tests..."
    node --test --test-isolation=none "tests/**/*.test.mjs"
    if ($LASTEXITCODE -ne 0) { Fail "unit tests failed" }
    Info "unit tests passed"
}

# 4) build desktop app
if (-not $SkipBuild) {
    Get-Process -Name noteapp -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    if ($env:NOTEAPP_BUNDLE -eq '1') {
        Info "building exe + installers (requires github.com for NSIS/WiX)"
        npm run desktop:build
    } else {
        Info "building runnable exe only (set NOTEAPP_BUNDLE=1 to also build MSI/NSIS)"
        npm run desktop:exe
    }
    if ($LASTEXITCODE -ne 0) { Fail "tauri build failed" }
}

# 5) collect assets
$assets = @()
$exe = Join-Path $root 'src-tauri\target\release\NoteApp.exe'
if (Test-Path $exe) { $assets += $exe } else { Warn "NoteApp.exe not found - release will have no exe asset" }
foreach ($pattern in @('src-tauri\target\release\bundle\msi\*.msi', 'src-tauri\target\release\bundle\nsis\*.exe')) {
    Get-ChildItem (Join-Path $root $pattern) -ErrorAction SilentlyContinue | ForEach-Object { $assets += $_.FullName }
}
Info ("assets: " + ($(if ($assets.Count) { $assets.Count } else { 0 })))

# 6) push branch + tag
Info "pushing $branch ..."
git push origin $branch
if ($LASTEXITCODE -ne 0) { Fail "git push failed (check credentials / network)" }

if (git rev-parse -q --verify "refs/tags/$tag" | Out-Null) {
    Warn "tag $tag already exists locally - reusing it"
} else {
    git tag -a $tag -m "NoteApp $Version"
}
git push origin $tag
if ($LASTEXITCODE -ne 0) { Fail "pushing tag failed" }

# 7) create GitHub release
$notesFile = Join-Path $root 'docs\RELEASE_NOTES_v0.1.0.md'
if (Get-Command gh -ErrorAction SilentlyContinue) {
    $ghArgs = @('release', 'create', $tag, '--title', "NoteApp $Version", '--verify-tag')
    if (Test-Path $notesFile) { $ghArgs += @('--notes-file', $notesFile) } else { $ghArgs += '--generate-notes' }
    if ($Draft) { $ghArgs += '--draft' }
    foreach ($a in $assets) { $ghArgs += $a }
    Info "creating GitHub release with gh ..."
    & gh @ghArgs
    if ($LASTEXITCODE -ne 0) { Fail "gh release create failed" }
    Info "release published: $tag"
} else {
    Warn "gh CLI not found - create the release manually:"
    Write-Host "  1) open $remote/releases/new?tag=$tag"
    Write-Host "  2) title: NoteApp $Version"
    if (Test-Path $notesFile) { Write-Host "  3) paste notes from: $notesFile" }
    if ($assets.Count) {
        Write-Host "  4) attach:"
        foreach ($a in $assets) { Write-Host "     $a" }
    }
}

Info "done."
