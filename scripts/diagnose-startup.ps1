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
Start-Sleep -Seconds 2
Say ('noteapp after cleanup: ' + (CountOf 'noteapp'))

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

$lines | Out-File -FilePath $report -Encoding utf8
Write-Host ''
Write-Host ('report written to: ' + $report) -ForegroundColor Green
