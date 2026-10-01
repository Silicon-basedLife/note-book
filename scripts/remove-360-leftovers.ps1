# scripts/remove-360-leftovers.ps1
# ---------------------------------------------------------------------------
# Remove the leftovers of a previously uninstalled 360 Safe (Qihoo 360 Safe Guard).
#
# WHY: on this machine 360 Safe is NOT listed as installed, yet its minifilter
#   C:\Windows\System32\drivers\360Box64.sys ("360Box mini-filter driver",
#   Group = FSFilter Activity Monitor, Start = system) is still loaded at every boot.
#   That filter denies noteapp.exe writes to %LOCALAPPDATA%\com.noteapp.desktop while the
#   same path stays writable for other processes, so NoteApp dies in Tauri's setup() with
#   "Failed to setup app: access denied (os error 5)" and its window only flashes.
#   Also left behind: HKLM\SOFTWARE\WOW6432Node\360Safe, %APPDATA%\360safe (software
#   manager cache) and an empty C:\Program Files (x86)\360.
#
# WHAT IT TOUCHES
#   1. backs up the service registration (reg export) and the driver file;
#   2. stops the 360Box64 driver, then deletes the service and the driver file; if the
#      driver cannot be stopped it is disabled instead and you are told to reboot;
#   3. deletes the leftovers listed above.
#
# WHAT IT NEVER TOUCHES (guarded in code)
#   - D:\360se6            360 Secure Browser - installed and in use, NOT part of this;
#   - D:\360MoveData       the migrated user profile data (your Desktop lives here!);
#   - HKCU\SOFTWARE\360    the browser's own settings.
#   A guard aborts if any target resolves inside those paths.
#
# UNDO: the backup folder holds 360Box64-service.reg and 360Box64.sys. Restore with
#   copy the .sys back to C:\Windows\System32\drivers\  then
#   reg import "<backup>\360Box64-service.reg"
#   (a reboot is needed for the driver to load again)
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads .ps1 as ANSI when there is
#       no BOM, so non-ASCII text can break parsing.
# ---------------------------------------------------------------------------
param(
  [string]$BackupDir = '',
  [string]$ReportPath = ''
)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "[ERROR] This script must run as Administrator." -ForegroundColor Red
  exit 1
}

$root = Split-Path -Parent $PSScriptRoot
if (-not $ReportPath) { $ReportPath = Join-Path $root '.tmp-remove-360-report.txt' }
if (-not $BackupDir) { $BackupDir = Join-Path $env:ProgramData ('noteapp-360-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')) }

$lines = New-Object System.Collections.Generic.List[string]
function Say([string]$text) {
  Write-Host $text
  $lines.Add($text)
}

Say "=== NoteApp: removing 360 Safe leftovers ==="
Say "backup dir : $BackupDir"
Say "report     : $ReportPath"
Say ""

# --- guard: never touch the browser or the migrated user data -----------------
$forbidden = @('D:\360se6', 'D:\360MoveData')
$targets = @(
  'HKLM:\SOFTWARE\WOW6432Node\360Safe',
  (Join-Path $env:APPDATA '360safe'),
  'C:\Program Files (x86)\360'
)
foreach ($t in $targets) {
  foreach ($f in $forbidden) {
    if ($t -like "$f*") {
      Say "[ABORT] Refusing to touch $t (inside protected path $f)."
      Set-Content -LiteralPath $ReportPath -Value $lines -Encoding utf8
      exit 1
    }
  }
}
Say "[OK] guard passed: no target is inside D:\360se6 or D:\360MoveData"
Say ""

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

# --- 1. back up ---------------------------------------------------------------
$driverPath = Join-Path $env:SystemRoot 'System32\drivers\360Box64.sys'
$serviceKey = 'HKLM\SYSTEM\CurrentControlSet\Services\360Box64'
if (Test-Path $driverPath) {
  Copy-Item -LiteralPath $driverPath -Destination (Join-Path $BackupDir '360Box64.sys') -Force
  Say "[OK] backed up the driver file"
}
$null = reg export $serviceKey (Join-Path $BackupDir '360Box64-service.reg') /y 2>&1
if (Test-Path (Join-Path $BackupDir '360Box64-service.reg')) {
  Say "[OK] backed up the service registration"
} else {
  Say "[WARN] could not export the service registration"
}
Say ""

# --- 2. the driver ------------------------------------------------------------
$svc = Get-Service -Name '360Box64' -ErrorAction SilentlyContinue
if (-not $svc) {
  Say "[--] 360Box64 service is not present (already removed)"
} else {
  Say "step: 360Box64 state before = $($svc.Status)"
  $null = sc.exe stop 360Box64 2>&1
  $stopped = $false
  for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 1000
    $now = (Get-Service -Name '360Box64' -ErrorAction SilentlyContinue).Status
    if ($now -eq 'Stopped') { $stopped = $true; break }
  }
  Say "step: 360Box64 state after  = $((Get-Service -Name '360Box64' -ErrorAction SilentlyContinue).Status)"

  if ($stopped) {
    $null = sc.exe delete 360Box64 2>&1
    Start-Sleep -Seconds 1
    if (Get-Service -Name '360Box64' -ErrorAction SilentlyContinue) {
      Say "[WARN] sc delete did not remove the service yet (it may need a reboot)"
    } else {
      Say "[OK] service 360Box64 deleted"
    }
    if (Test-Path $driverPath) {
      try {
        Remove-Item -LiteralPath $driverPath -Force
        Say "[OK] driver file deleted: $driverPath"
      } catch {
        Say "[WARN] could not delete the driver file: $($_.Exception.Message)"
        Say "       it is probably still mapped; reboot and run this script again"
      }
    } else {
      Say "[--] driver file already gone"
    }
  } else {
    $null = sc.exe config 360Box64 start= disabled 2>&1
    Say "[ACTION NEEDED] the driver could not be stopped, so it was DISABLED instead."
    Say "                Reboot Windows, then run this script again to delete it."
  }
}
Say ""

# --- 3. leftovers -------------------------------------------------------------
if (Test-Path 'HKLM:\SOFTWARE\WOW6432Node\360Safe') {
  Remove-Item -Path 'HKLM:\SOFTWARE\WOW6432Node\360Safe' -Recurse -Force
  Say "[OK] removed HKLM\SOFTWARE\WOW6432Node\360Safe (360 Safe updater leftover)"
} else {
  Say "[--] HKLM\SOFTWARE\WOW6432Node\360Safe not present"
}

$appdata360 = Join-Path $env:APPDATA '360safe'
if (Test-Path $appdata360) {
  Remove-Item -LiteralPath $appdata360 -Recurse -Force
  Say "[OK] removed $appdata360 (360 Safe software manager cache)"
} else {
  Say "[--] $appdata360 not present"
}

$prog360 = 'C:\Program Files (x86)\360'
if (Test-Path $prog360) {
  $left = @(Get-ChildItem -LiteralPath $prog360 -Force -ErrorAction SilentlyContinue)
  if ($left.Count -eq 0) {
    Remove-Item -LiteralPath $prog360 -Force
    Say "[OK] removed the empty folder $prog360"
  } else {
    Say "[SKIP] $prog360 still has $($left.Count) entries - not empty, left alone"
  }
} else {
  Say "[--] $prog360 not present"
}
Say ""

# --- 4. what was intentionally kept ------------------------------------------
Say "kept on purpose (NOT part of 360 Safe):"
Say "  D:\360se6       360 Secure Browser (installed, in use)"
Say "  D:\360MoveData  your migrated profile data - your Desktop is in there"
Say "  HKCU\SOFTWARE\360  the browser's settings"
Say ""
Say "backup: $BackupDir"
Say "=== done ==="

Set-Content -LiteralPath $ReportPath -Value $lines -Encoding utf8
Write-Host ""
Write-Host "Report written to $ReportPath" -ForegroundColor Green
