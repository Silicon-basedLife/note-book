# scripts/ci-check.ps1 - run one verification command and make its failure diagnosable.
#
# WHY THIS EXISTS (2026-10-01, while publishing v0.2.0):
#   A failing step in GitHub Actions only surfaces as
#     "Process completed with exit code 1."
#   in the Checks UI, and downloading the full job log requires authentication. The v0.2.0
#   release run failed in the unit-test step after 3 seconds, and the cause could not be read
#   from the public API at all - the run had to be diagnosed blind.
#   This wrapper captures the command output and:
#     1. appends it to $GITHUB_STEP_SUMMARY, which is exposed through the public
#        check-run API as output.summary;
#     2. emits an ::error:: workflow command, which becomes a check annotation
#        (also readable through the public annotations API);
#     3. exits with the wrapped command's exit code, so the step still fails.
#
# USAGE (in .github/workflows/*.yml)
#   - name: Unit tests
#     shell: pwsh
#     run: |
#       & ./scripts/ci-check.ps1 -Label 'Unit tests' -Command 'node --test ...'
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads .ps1 as ANSI when there is no
#       BOM, and the repository guard rejects non-ASCII in scripts either way.
param(
  [Parameter(Mandatory = $true)][string]$Label,
  [Parameter(Mandatory = $true)][string]$Command,
  [int]$MaxLines = 80
)

$ErrorActionPreference = 'Continue'
Write-Host "=== $Label ==="
Write-Host "> $Command"

$output = & ([scriptblock]::Create($Command)) 2>&1 | Out-String
$code = $LASTEXITCODE
Write-Host $output

if ($code -eq 0) {
  Write-Host "::notice title=$Label::passed"
  exit 0
}

$lines = $output -split "`r?`n"

# The summary shows up in the public check-run API, so a failing run can be diagnosed
# without access to the authenticated log download.
$summary = $env:GITHUB_STEP_SUMMARY
if ($summary) {
  "## FAILED: $Label (exit $code)" | Out-File -Append -Encoding utf8 $summary
  '```text' | Out-File -Append -Encoding utf8 $summary
  ($lines | Select-Object -First $MaxLines) | Out-File -Append -Encoding utf8 $summary
  if ($lines.Count -gt $MaxLines) {
    "... ($($lines.Count - $MaxLines) more lines; see the job log)" | Out-File -Append -Encoding utf8 $summary
  }
  '```' | Out-File -Append -Encoding utf8 $summary
}

# Annotations are also publicly readable, and they must carry enough context to act on.
# The failing detail often sits on the lines AFTER the match (for example a guard's list of
# offenders after "AssertionError: Expected values to be strictly deep-equal:"), so take a
# window around every hit rather than the matching line alone.
# (ASCII only: node:test prints "not ok" for failures, so no non-ASCII marker is needed here.)
$hitIndexes = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($lines[$i] -match 'not ok|Error|error:|Cannot find|FAIL|failed') { $hitIndexes += $i }
  if ($hitIndexes.Count -ge 3) { break }
}
$picked = @()
foreach ($i in $hitIndexes) {
  $from = [Math]::Max(0, $i - 1)
  $to = [Math]::Min($lines.Count - 1, $i + 6)
  for ($j = $from; $j -le $to; $j++) { if ($lines[$j].Trim()) { $picked += $lines[$j].Trim() } }
}
$detail = if ($picked.Count) { ($picked | Select-Object -Unique) -join ' || ' } else { "exit code $code" }
if ($detail.Length -gt 1900) { $detail = $detail.Substring(0, 1900) }
Write-Host "::error title=$Label failed::$detail"

exit $code
