// scripts/kill-running-app.mjs
// ---------------------------------------------------------------------------
// Runs before every desktop build (via npm "pre" hooks) to prepare a clean start.
//
// 1) Kill a running NoteApp.
//    Windows locks a running exe, so cargo cannot overwrite it:
//      error: failed to remove file `...\target\release\noteapp.exe`
//      Caused by: 拒绝访问。 (os error 5)
//
// 2) ROTATE the WebView2 data directory. This is the important one.
//    WebView2's browser process (msedgewebview2.exe) does NOT die with its host.
//    Force-killing NoteApp while WebView2 is using its profile leaves that
//    profile damaged, and from then on EVERY launch fails inside Tauri's
//    setup() - the step that creates the window and the webview - either by
//    panicking ("Failed to setup app: <io error>") or by hanging forever with
//    no window and no message.
//    Observed on 2026-09-30: msedgewebview2.exe crashed 12 times in msedge.dll
//    with "Exception code: 0x80000003" (STATUS_BREAKPOINT, i.e. a Chromium
//    CHECK failure); the window flashed and closed; the app only started
//    working again after the WebView2 folder was deleted (reboot + delete).
//    Rotating costs one slightly slower first launch and nothing else: that
//    folder holds only the webview cache/localStorage. Notes and settings live
//    in %APPDATA%\<identifier>\ (notes/*.md, meta.json, settings.json).
//
// 3) Keep the two most recent rotated profiles (so a bad one can be inspected)
//    and delete older ones.
//
// Cross-platform safe: anything other than Windows exits successfully.
// NOTE: taskkill is called with stdio:'ignore' on purpose - capturing output
//       needs a pipe, which confined environments can refuse.
// ---------------------------------------------------------------------------
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEEP_ROTATED = 2;

if (process.platform !== 'win32') {
  process.exit(0);
}

// Windows filenames are case-insensitive; try both spellings.
for (const name of ['noteapp.exe', 'NoteApp.exe']) {
  try {
    execFileSync('taskkill', ['/f', '/im', name], { stdio: 'ignore' });
  } catch {
    // Non-zero means "no such process", which is the common case.
  }
}

// Give Windows a moment to release the exe and the WebView2 profile handles.
await new Promise((resolve) => setTimeout(resolve, 1500));

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Read the bundle identifier from tauri.conf.json so this keeps working if it changes.
let identifier = 'com.noteapp.desktop';
try {
  const conf = JSON.parse(readFileSync(join(root, 'src-tauri', 'tauri.conf.json'), 'utf8'));
  if (conf && typeof conf.identifier === 'string' && conf.identifier.trim()) {
    identifier = conf.identifier.trim();
  }
} catch {
  // Fall back to the known identifier.
}

const localAppData = process.env.LOCALAPPDATA;
// Optional override, used by tests and available as an escape hatch for relocating
// the webview profile. Defaults to %LOCALAPPDATA%\<identifier>.
const override = (process.env.NOTEAPP_WEBVIEW_DIR || '').trim();
if (!override && !localAppData) {
  console.log('[prebuild] LOCALAPPDATA is not set; skipped the WebView2 profile rotation.');
  process.exit(0);
}

const appDir = override || join(localAppData, identifier);
const profile = join(appDir, 'EBWebView');

if (!existsSync(profile)) {
  console.log('[prebuild] Stopped any running NoteApp; no WebView2 profile to rotate.');
  process.exit(0);
}

// Fixed-width millisecond stamp: unique per run and sortable for pruning.
const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 17);
const rotated = join(appDir, `EBWebView.rotated-${stamp}`);

try {
  renameSync(profile, rotated);
  console.log(`[prebuild] Rotated the WebView2 profile to ${rotated}`);
  console.log('[prebuild]   (webview cache only - your notes and settings are untouched)');
} catch (err) {
  console.log(`[prebuild] Could not rotate the WebView2 profile: ${err.message}`);
  console.log('[prebuild]   If the next launch shows no window, delete this folder by hand:');
  console.log(`[prebuild]   ${profile}`);
  process.exit(0);
}

// Prune older rotations, newest first (the fixed-width timestamp sorts lexicographically).
try {
  const old = readdirSync(appDir)
    .filter((name) => name.startsWith('EBWebView.rotated-') || name.startsWith('EBWebView.stale-'))
    .sort()
    .reverse();
  for (const name of old.slice(KEEP_ROTATED)) {
    try {
      rmSync(join(appDir, name), { recursive: true, force: true });
    } catch (err) {
      // Report instead of swallowing: a silent failure here is what lets rotated
      // profiles pile up and hide a real problem.
      console.log(`[prebuild] Could not remove the old profile ${name}: ${err.message}`);
    }
  }
} catch (err) {
  console.log(`[prebuild] Could not list the app data directory for pruning: ${err.message}`);
}
