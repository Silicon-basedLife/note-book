# scripts/diagnose-startup.ps1
# ---------------------------------------------------------------------------
# Diagnose NoteApp desktop startup failure. Writes a full report to
# .tmp-run-report.txt in the repo root, so it can be read without copy/paste.
#
#   Usage: npm run diagnose:startup
#   or:    powershell -NoProfile -ExecutionPolicy Bypass -File scripts/diagnose-startup.ps1
#
# It kills leftover instances, starts the exe with stdout/stderr redirected,
# records process/window state once per second, captures the exit code and its
# meaning, then summarizes webview + profile state into the report file.
# It deletes nothing; a started instance is left running so you can look at it.
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads .ps1 as ANSI when
#       there is no BOM, so non-ASCII text can break parsing (same rule as setup.ps1).
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$exe = Join-Path $root 'src-tauri\target\release\noteapp.exe'
$outFile = Join-Path $root '.tmp-run-out.txt'
$errFile = Join-Path $root '.tmp-run-err.txt'
$report = Join-Path $root '.tmp-run-report.txt'

$lines = New-Object System.Collections.Generic.List[string]
function Say([string]$m) {
  $lines.Add($m)
  Write-Host $m
}

function ExitCodeMeaning([int]$code) {
  switch ($code) {
    0           { return 'clean exit - event loop ended, i.e. every window was closed' }
    101         { return 'RUST PANIC - see the stderr section below' }
    -1073741819 { return '0xC0000005 ACCESS VIOLATION (hard crash, usually no stderr)' }
    -1073741510 { return '0xC000013A terminated (Ctrl+C / window force-closed)' }
    -1073740791 { return '0xC0000409 STATUS_STACK_BUFFER_OVERRUN' }
    -1073741571 { return '0xC00000FD stack overflow' }
    default     { return ('unknown exit code, hex 0x{0:X8}' -f $code) }
  }
}

function CountOf([string]$name) {
  return @(Get-Process -Name $name -ErrorAction SilentlyContinue).Count
}

Say '=== NoteApp startup diagnosis ==='
Say ('time      : ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
Say ('exe       : ' + $exe)
if (Test-Path $exe) {
  $f = Get-Item $exe
  Say ('exe state : present, size ' + $f.Length + ' bytes, modified ' + $f.LastWriteTime)
  try {
    $sig = Get-AuthenticodeSignature $exe
    Say ('exe signed: ' + $sig.Status + '  (a local build is normally NotSigned)')
  } catch { Say 'exe signed: query failed' }
} else {
  Say 'exe state : MISSING - run npm run desktop:exe first'
  $lines | Out-File -FilePath $report -Encoding utf8
  Write-Host ('report: ' + $report) -ForegroundColor Yellow
  exit 1
}

Say ''
Say '--- environment before launch ---'
Say ('noteapp processes    : ' + (CountOf 'noteapp'))
Say ('msedgewebview2 procs : ' + (CountOf 'msedgewebview2'))
$eb = Join-Path $env:LOCALAPPDATA 'com.noteapp.desktop\EBWebView'
if (Test-Path $eb) {
  Say ('WebView2 profile     : present, files = ' + @(Get-ChildItem $eb -Recurse -File -Force -ErrorAction SilentlyContinue).Count)
} else {
  Say 'WebView2 profile     : MISSING (the webview never initialized successfully)'
}

# Kill leftovers: a running instance keeps the exe locked and can hide the new one.
Get-Process noteapp -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# WebView2's browser processes are NOT children that die with their host: killing
# noteapp.exe with -Force leaves msedgewebview2.exe orphans holding the profile.
# Match them by the profile path in their command line so other apps are untouched.
$orphans = @()
$cimOk = $true
try {
  $orphans = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction Stop |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*com.noteapp.desktop*' })
} catch { $cimOk = $false }
Say ('webview orphans owned by NoteApp : ' + $orphans.Count)
if (-not $cimOk) {
  $allWv = CountOf 'msedgewebview2'
  Say 'WARNING: could not read process command lines (access denied), so orphan webview'
  Say ('         processes cannot be attributed. msedgewebview2.exe running now: ' + $allWv)
  if ($allWv -gt 0) {
    Say '         If the next launch still hangs, kill them and retry:'
    Say '           taskkill /f /im msedgewebview2.exe'
  }
}
foreach ($o in $orphans) {
  try { Stop-Process -Id $o.ProcessId -Force -ErrorAction SilentlyContinue } catch { }
}
if ($orphans.Count -gt 0) { Start-Sleep -Seconds 2 }

Start-Sleep -Seconds 1
Say ('noteapp after cleanup: ' + (CountOf 'noteapp'))

# A profile whose LOCK is still held (a stale lock, or a process we cannot see) makes
# WebView2 block forever, and the app then never creates its main window. Move the
# profile aside so the next start gets a virgin one. Reversible: it is only renamed.
$lockPath = Join-Path $eb 'Default\LOCK'
$lockHeld = $false
if (Test-Path $lockPath) {
  try {
    $fs = [System.IO.File]::Open($lockPath, 'Open', 'ReadWrite', 'None')
    $fs.Close()
  } catch { $lockHeld = $true }
}
if ($lockHeld) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $moved = Join-Path (Split-Path $eb -Parent) ('EBWebView.stale-' + $stamp)
  try {
    Move-Item -LiteralPath $eb -Destination $moved -Force -ErrorAction Stop
    Say ('profile LOCK was held -> moved profile to: ' + $moved)
    Say '  (this only resets the WebView2 cache; your notes are untouched)'
  } catch {
    Say ('profile LOCK is held and moving it FAILED: ' + $_.Exception.Message)
  }
} else {
  Say 'profile LOCK is free (no reset needed)'
}

Remove-Item $outFile, $errFile -Force -ErrorAction SilentlyContinue

Say ''
Say '--- launch ---'
$p = Start-Process -FilePath $exe -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
Say ('started PID          : ' + $p.Id)

Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
$seenWindow = $false
$windowSeenAt = 0

for ($i = 1; $i -le 25; $i++) {
  Start-Sleep -Seconds 1
  try { $p.Refresh() } catch { }
  if ($p.HasExited) {
    $code = $p.ExitCode
    Say ('[' + $i + 's] process EXITED  ExitCode = ' + $code + '  (0x' + ('{0:X8}' -f $code) + ')')
    Say ('       meaning: ' + (ExitCodeMeaning $code))
    break
  }
  $h = 0
  try { $h = [int64]$p.MainWindowHandle } catch { }
  $rect = ''
  $isReal = $false
  if ($h -ne 0) {
    try {
      Add-Type -Namespace Diag -Name Win -MemberDefinition '[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); public struct RECT { public int Left, Top, Right, Bottom; }' -ErrorAction SilentlyContinue
      $r = New-Object Diag.Win+RECT
      [void][Diag.Win]::GetWindowRect([IntPtr]$h, [ref]$r)
      $w = $r.Right - $r.Left
      $ht = $r.Bottom - $r.Top
      $rect = '  pos=(' + $r.Left + ',' + $r.Top + ') size=' + $w + 'x' + $ht
      # Tao creates a hidden 16x16 helper window at (0,0); .NET reports it as the main
      # window, but the real app window is at least tauri.conf.json's minWidth (232).
      if ($w -ge 200) {
        $isReal = $true
      } else {
        $rect = $rect + '   <- Tao helper window, NOT the app window'
      }
    } catch { }
  }
  if ($isReal -and -not $seenWindow) { $seenWindow = $true; $windowSeenAt = $i }
  Say ('[' + $i + 's] running  MainWindowHandle = ' + $h + $rect)
}

if (-not $p.HasExited) {
  Say ''
  Say 'still running after 25s.'
  Say ('MainWindowHandle = ' + $p.MainWindowHandle + '   (0 means no main window was ever created)')
  try {
    foreach ($s in [System.Windows.Forms.Screen]::AllScreens) { Say ('  screen: ' + $s.DeviceName + ' ' + $s.Bounds) }
  } catch { }
}

Say ''
if ($seenWindow) {
  Say ('A main window was seen, first at about ' + $windowSeenAt + 's.')
} else {
  Say 'WARNING: no main window handle was ever observed within 25s.'
}

Say ''
Say '--- stderr (Rust panics are written here) ---'
if (Test-Path $errFile) {
  $e = Get-Content $errFile -Raw -ErrorAction SilentlyContinue
  if ([string]::IsNullOrWhiteSpace($e)) { Say '(empty)' } else { Say $e }
} else { Say '(file not created)' }

Say ''
Say '--- stdout ---'
if (Test-Path $outFile) {
  $o = Get-Content $outFile -Raw -ErrorAction SilentlyContinue
  if ([string]::IsNullOrWhiteSpace($o)) { Say '(empty)' } else { Say $o }
} else { Say '(file not created)' }

Say ''
Say '--- environment after launch ---'
Say ('msedgewebview2 procs : ' + (CountOf 'msedgewebview2') + '   (>0 means WebView2 did start)')
if (Test-Path $eb) {
  Say ('WebView2 profile     : files = ' + @(Get-ChildItem $eb -Recurse -File -Force -ErrorAction SilentlyContinue).Count)
} else {
  Say 'WebView2 profile     : still MISSING - WebView2 never started'
}
Say ('noteapp processes    : ' + (CountOf 'noteapp'))

Say ''
Say '--- WebView2 crash events in the last 30 minutes (Event ID 1000) ---'
# This is the decisive check: if msedgewebview2.exe / msedge.dll is crashing, the
# WebView2 engine itself is failing, and the app can only wait forever for a webview
# that never arrives (no window, no error, no exit).
try {
  $crashes = @(Get-WinEvent -FilterHashtable @{LogName='Application'; Id=1000; StartTime=(Get-Date).AddMinutes(-30)} -MaxEvents 200 -ErrorAction Stop |
    Where-Object { $_.Message -match 'msedgewebview2' })
  Say ('msedgewebview2.exe crashes : ' + $crashes.Count)
  if ($crashes.Count -gt 0) {
    $sample = $crashes[0].Message
    foreach ($line in ($sample -split "`r?`n")) {
      if ($line -match 'Faulting module name|Exception code|Fault offset|Faulting application path') {
        Say ('  ' + $line.Trim())
      }
    }
    Say '  >> The WebView2 runtime itself is crashing. Fix the runtime/profile, not NoteApp:'
    Say '     1) reboot, 2) rename/delete the EBWebView profile folder, 3) retry,'
    Say '     4) if it still crashes, repair/reinstall the WebView2 Evergreen Runtime.'
  }
} catch { Say 'msedgewebview2.exe crashes : (could not read the event log)' }

$lines | Out-File -FilePath $report -Encoding utf8
Write-Host ''
Write-Host ('report written to: ' + $report) -ForegroundColor Green
