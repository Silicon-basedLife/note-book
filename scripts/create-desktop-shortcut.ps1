# scripts/create-desktop-shortcut.ps1
# ---------------------------------------------------------------------------
# Create a Desktop shortcut that starts NoteApp reliably.
#
# WHY a shortcut through cmd.exe instead of straight to the exe:
#   Double-clicking an exe goes through Explorer's ShellExecute, which is where the
#   "Open File - Security Warning" prompt ("publisher cannot be verified") comes
#   from. Going through
#      cmd /c start "" "<exe>"
#   starts the process directly (CreateProcess), which does not raise that prompt.
#   That is also why the same exe launches without any prompt from PowerShell.
#   WindowStyle is Minimized so the helper console does not sit on screen.
#
#   Usage: npm run shortcut:desktop
#          or: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/create-desktop-shortcut.ps1
#   Optional: -OutDir <dir>   (defaults to the current user's Desktop; used by tests)
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads .ps1 as ANSI when
#       there is no BOM, so non-ASCII text can break parsing (same rule as setup.ps1).
# ---------------------------------------------------------------------------
param(
  [string]$OutDir = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'src-tauri\target\release\noteapp.exe'

if (-not (Test-Path $exe)) {
  Write-Host "[ERROR] Not found: $exe" -ForegroundColor Red
  Write-Host "        Build it first:  npm run desktop:exe" -ForegroundColor Yellow
  exit 1
}

if (-not $OutDir) { $OutDir = [Environment]::GetFolderPath('Desktop') }
if (-not (Test-Path $OutDir)) {
  Write-Host "[ERROR] Output directory does not exist: $OutDir" -ForegroundColor Red
  exit 1
}

$lnk = Join-Path $OutDir 'NoteApp.lnk'
$icon = Join-Path $root 'src-tauri\icons\icon.ico'

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
# cmd /c start "" "<exe>"  -> CreateProcess, no ShellExecute publisher prompt.
$sc.TargetPath = Join-Path $env:SystemRoot 'System32\cmd.exe'
$sc.Arguments = '/c start "" "' + $exe + '"'
$sc.WorkingDirectory = Split-Path -Parent $exe
$sc.WindowStyle = 7            # 7 = minimized
$sc.Description = 'NoteApp - local Markdown notes'
if (Test-Path $icon) { $sc.IconLocation = $icon }
$sc.Save()

Write-Host "[OK] Shortcut created: $lnk" -ForegroundColor Green
Write-Host "     target : $($sc.TargetPath) $($sc.Arguments)"
if (Test-Path $icon) { Write-Host "     icon   : $icon" }
Write-Host "     Double-click it to start NoteApp without the publisher prompt." -ForegroundColor Green

# Verify by re-reading the file: a silent failure here would leave the user hunting for
# an icon that was never written (the Desktop is often relocated, e.g. by 360's
# system-drive migration, so "look on the Desktop" is not a reliable check).
if (-not (Test-Path $lnk)) {
  Write-Host "[ERROR] The shortcut file does not exist after saving: $lnk" -ForegroundColor Red
  exit 1
}
$check = $shell.CreateShortcut($lnk)
if ($check.TargetPath -ne $sc.TargetPath -or $check.Arguments -ne $sc.Arguments) {
  Write-Host "[ERROR] Verification failed: the shortcut does not read back as written." -ForegroundColor Red
  exit 1
}
Write-Host ("[OK] Verified: {0} bytes at {1}" -f (Get-Item $lnk).Length, (Get-Item $lnk).FullName) -ForegroundColor Green
Write-Host "     (this is the Desktop Windows reports; if it was relocated, look there)" -ForegroundColor DarkGray
