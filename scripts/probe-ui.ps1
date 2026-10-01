# scripts/probe-ui.ps1
# ---------------------------------------------------------------------------
# Ask the RUNNING NoteApp what its webview actually contains, and optionally take a
# screenshot of it. This is the tool for "the window is blank / white" reports: it
# distinguishes "the page never loaded" from "the page loaded but the UI did not render"
# and from "the UI rendered fine" - without guessing.
#
# HOW TO USE
#   1. start the app with WebView2 remote debugging enabled:
#        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
#        .\src-tauri\target\release\noteapp.exe
#      (or: npm run probe:ui -- -Launch)
#   2. run:  npm run probe:ui
#      optional: -Out shot.png     also save a screenshot
#                -Port 9223        debug port (default 9223)
#                -Page main|settings
#
# WHAT IT PRINTS: page url/title, readyState, element count, DOM length, the loaded
# resources (JS/CSS and every invoke call), and any JavaScript exception or console error
# that happens during a reload.
#
# NOTE: keep this file pure ASCII (Windows PowerShell 5.1 reads .ps1 as ANSI without a BOM).
# ---------------------------------------------------------------------------
param(
  [int]$Port = 9223,
  [string]$Page = 'main',
  [string]$Out = '',
  [switch]$Launch
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if ($Launch) {
  $exe = Join-Path $root 'src-tauri\target\release\noteapp.exe'
  if (-not (Test-Path $exe)) { Write-Host "[ERROR] build it first: npm run desktop:exe" -ForegroundColor Red; exit 1 }
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$Port"
  Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) | Out-Null
  Write-Host "[OK] launched with remote debugging on port $Port"
  Start-Sleep -Seconds 6
}

try {
  $targets = Invoke-RestMethod "http://127.0.0.1:$Port/json" -TimeoutSec 5
} catch {
  Write-Host "[ERROR] no debug port on $Port - start the app with" -ForegroundColor Red
  Write-Host "        `$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=$Port'"
  exit 1
}

$want = if ($Page -eq 'settings') { '*settings.html*' } else { '' }
$target = $targets |
  Where-Object { $_.type -eq 'page' -and $(if ($want) { $_.url -like $want } else { $_.url -notlike '*settings.html*' }) } |
  Select-Object -First 1
if (-not $target) { Write-Host "[ERROR] no matching page target" -ForegroundColor Red; exit 1 }

Write-Host "attached : $($target.url)   ($($target.title))"

$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [System.Threading.CancellationToken]::None
$ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, $ct).Wait(10000) | Out-Null

function Send-Cdp($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 12
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $seg = [System.ArraySegment[byte]]::new($bytes)
  $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait(8000) | Out-Null
}

# A WebSocket message may arrive in several frames, so keep reading until EndOfMessage.
# Reading a single frame silently truncates anything larger (a screenshot, for example).
function Receive-Cdp([int]$timeoutMs) {
  $sb = New-Object System.Text.StringBuilder
  $deadline = (Get-Date).AddMilliseconds($timeoutMs)
  do {
    try {
      $chunk = New-Object byte[] 262144
      $seg = [System.ArraySegment[byte]]::new($chunk)
      $task = $ws.ReceiveAsync($seg, $ct)
      $left = [int]($deadline - (Get-Date)).TotalMilliseconds
      if ($left -lt 200) { return $null }
      if (-not $task.Wait($left)) { return $null }
      $null = $sb.Append([System.Text.Encoding]::UTF8.GetString($chunk, 0, $task.Result.Count))
      $end = $task.Result.EndOfMessage
    } catch { return $null }
  } while (-not $end)
  return $sb.ToString()
}

Send-Cdp @{ id = 1; method = 'Runtime.enable' }
Send-Cdp @{ id = 2; method = 'Log.enable' }
Send-Cdp @{ id = 3; method = 'Page.enable' }
Start-Sleep -Milliseconds 400

$expr = 'JSON.stringify({ready:document.readyState,elements:document.querySelectorAll("*").length,' +
  'bodyLen:document.body?document.body.innerHTML.length:-1,' +
  'resources:performance.getEntriesByType("resource").map(r=>r.name.replace("http://tauri.localhost","").replace("http://ipc.localhost","ipc")),' +
  'body:document.body?document.body.innerHTML.slice(0,300):null})'
Send-Cdp @{ id = 4; method = 'Runtime.evaluate'; params = @{ expression = $expr; returnByValue = $true } }
if ($Out) { Send-Cdp @{ id = 5; method = 'Page.captureScreenshot'; params = @{ format = 'png' } } }

$deadline = (Get-Date).AddSeconds(20)
$problems = 0
while ((Get-Date) -lt $deadline) {
  $msg = Receive-Cdp 3000
  if (-not $msg) { continue }
  try { $o = $msg | ConvertFrom-Json } catch { continue }

  if ($o.id -eq 4 -and $o.result.result.value) {
    $state = $o.result.result.value | ConvertFrom-Json
    Write-Host ""
    Write-Host "readyState : $($state.ready)"
    Write-Host "elements   : $($state.elements)"
    Write-Host "DOM bytes  : $($state.bodyLen)"
    Write-Host "resources  :"
    $state.resources | ForEach-Object { Write-Host "  $_" }
    Write-Host "body start : $($state.body)"
  }
  if ($o.id -eq 5 -and $o.result.data) {
    [System.IO.File]::WriteAllBytes($Out, [Convert]::FromBase64String($o.result.data))
    Write-Host ""
    Write-Host "[OK] screenshot: $Out ($((Get-Item $Out).Length) bytes)" -ForegroundColor Green
  }
  if ($o.method -eq 'Runtime.exceptionThrown') {
    $problems++
    $d = $o.params.exceptionDetails
    Write-Host "[EXCEPTION] $($d.text) @ $($d.url):$($d.lineNumber)" -ForegroundColor Red
    if ($d.exception) { Write-Host "            $($d.exception.description)" -ForegroundColor Red }
  }
  if ($o.method -eq 'Log.entryAdded' -and $o.params.entry.level -in @('error', 'warning')) {
    $problems++
    Write-Host "[$($o.params.entry.level)] $($o.params.entry.text)" -ForegroundColor Yellow
  }
}

try { $ws.Dispose() } catch { }
if ($problems -eq 0) {
  Write-Host ""
  Write-Host "[OK] no JavaScript exception or console error was reported" -ForegroundColor Green
}
