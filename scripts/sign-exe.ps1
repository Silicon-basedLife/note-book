# scripts/sign-exe.ps1
# ---------------------------------------------------------------------------
# Sign the built NoteApp exe with a self-signed code-signing certificate, and trust that
# certificate for the current user.
#
# WHY: an UNSIGNED exe makes Windows show the "Open File - Security Warning" dialog
#   ("publisher cannot be verified - are you sure you want to run this software?" /
#   "this file does not have a valid digital signature"). Every rebuild produces a NEW
#   unsigned binary, so the warning comes back after each build even though the code did
#   not change. Signing makes the dialog's own complaint false: the file then carries a
#   valid signature from a publisher this account trusts.
#
# WHAT IT DOES (all of it in the CURRENT USER's stores - no administrator needed)
#   1. reuses an existing "CN=NoteApp Local Build" code-signing certificate, or creates one
#      in Cert:\CurrentUser\My (5 years, RSA 2048, code-signing EKU);
#   2. exports the public part to <repo>\.signing\noteapp-codesign.cer and installs it into
#      Cert:\CurrentUser\Root and Cert:\CurrentUser\TrustedPublisher (idempotent);
#   3. signs the exe (release, and debug when present) with SHA-256;
#   4. verifies with Get-AuthenticodeSignature and fails if the status is not Valid.
#
# SECURITY NOTE (state it to the user, do not hide it): trusting a self-signed certificate
#   means anything signed with that private key is trusted by this Windows account. The
#   private key stays in the user's certificate store (Cert:\CurrentUser\My). Undo with:
#     Get-ChildItem Cert:\CurrentUser\My, Cert:\CurrentUser\Root, Cert:\CurrentUser\TrustedPublisher |
#       Where-Object { $_.Subject -eq 'CN=NoteApp Local Build' } | Remove-Item
#
# NOTE: keep this file pure ASCII. Windows PowerShell 5.1 reads .ps1 as ANSI when there is
#       no BOM, so non-ASCII text can break parsing.
# ---------------------------------------------------------------------------
param(
  [string]$ExePath = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$subject = 'CN=NoteApp Local Build'

$targets = @()
if ($ExePath) {
  $targets += $ExePath
} else {
  foreach ($candidate in @('src-tauri\target\release\noteapp.exe', 'src-tauri\target\debug\noteapp.exe')) {
    $full = Join-Path $root $candidate
    if (Test-Path $full) { $targets += $full }
  }
}
if ($targets.Count -eq 0) {
  Write-Host "[ERROR] No built exe found. Build it first: npm run desktop:exe" -ForegroundColor Red
  exit 1
}

# --- 1. certificate ----------------------------------------------------------
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
  Where-Object { $_.Subject -eq $subject -and $_.HasPrivateKey } |
  Sort-Object NotAfter -Descending |
  Select-Object -First 1

if (-not $cert) {
  $cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $subject `
    -CertStoreLocation 'Cert:\CurrentUser\My' `
    -NotAfter (Get-Date).AddYears(5) `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA `
    -KeyLength 2048
  Write-Host "[OK] created a self-signed code-signing certificate" -ForegroundColor Green
} else {
  Write-Host "[--] reusing the existing certificate (expires $($cert.NotAfter.ToString('yyyy-MM-dd')))"
}

# --- 2. trust it for this user ----------------------------------------------
$cerDir = Join-Path $root '.signing'
if (-not (Test-Path $cerDir)) { New-Item -ItemType Directory -Path $cerDir -Force | Out-Null }
$cerPath = Join-Path $cerDir 'noteapp-codesign.cer'
Export-Certificate -Cert $cert -FilePath $cerPath -Force | Out-Null

foreach ($store in @('Root', 'TrustedPublisher')) {
  $location = "Cert:\CurrentUser\$store"
  $present = Get-ChildItem $location -ErrorAction SilentlyContinue |
    Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
  if ($present) {
    Write-Host "[--] already trusted in CurrentUser\$store"
  } else {
    Import-Certificate -FilePath $cerPath -CertStoreLocation $location | Out-Null
    Write-Host "[OK] trusted in CurrentUser\$store" -ForegroundColor Green
  }
}

# --- 3. sign and verify ------------------------------------------------------
$failed = 0
foreach ($exe in $targets) {
  try {
    $null = Set-AuthenticodeSignature -FilePath $exe -Certificate $cert -HashAlgorithm SHA256
  } catch {
    Write-Host "[ERROR] signing failed for $exe : $($_.Exception.Message)" -ForegroundColor Red
    $failed = 1
    continue
  }
  $check = Get-AuthenticodeSignature $exe
  if ($check.Status -eq 'Valid') {
    Write-Host "[OK] signed: $exe" -ForegroundColor Green
    Write-Host "     status = $($check.Status)   signer = $($check.SignerCertificate.Subject)"
  } else {
    Write-Host "[ERROR] signature is not valid for $exe : $($check.Status)" -ForegroundColor Red
    if ($check.StatusMessage) { Write-Host "        $($check.StatusMessage)" -ForegroundColor Yellow }
    $failed = 1
  }
}

if ($failed) { exit 1 }
Write-Host ""
Write-Host "Done. Double-clicking the exe should no longer show the publisher warning."
