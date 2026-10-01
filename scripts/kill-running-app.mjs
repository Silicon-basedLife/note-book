// scripts/kill-running-app.mjs
// ---------------------------------------------------------------------------
// Runs before every desktop build (via npm "pre" hooks) to prepare a clean start.
//
// 1) Kill a running NoteApp.
//    Windows locks a running exe, so cargo cannot overwrite it:
//      error: failed to remove file `...\target\release\noteapp.exe`
//      Caused by: 拒绝访问。 (os error 5)
//
// 2) CLEAR the WebView2 profile.
//    WebView2's browser process (msedgewebview2.exe) does NOT die with its host, so
//    force-killing NoteApp while WebView2 uses the profile can leave it damaged; every
//    later launch then fails inside Tauri's setup() - the step that creates the window
//    and the webview. Observed 2026-09-30: 12 crashes of msedgewebview2.exe in
//    msedge.dll (Exception code 0x80000003 = STATUS_BREAKPOINT) plus
//    "Failed to setup app: 拒绝访问 (os error 5)" on every start.
//
//    Clearing the CONTENTS (instead of renaming the folder aside) is deliberate:
//      - a normal profile folder must KEEP EXISTING, because on some machines the app
//        cannot create that path itself (security software blocks this app's writes to
//        %LOCALAPPDATA%\<identifier> by path - the parent stays "拒绝访问" while a
//        junction target is writable);
//      - when the folder is a junction that redirects the profile to a writable place,
//        clearing through the link clears the target and the link stays valid - and no
//        junction detection is needed, which matters because Node cannot detect Windows
//        junctions at all (realpathSync returns the link's own path,
//        lstatSync().isSymbolicLink() is false, readlinkSync() throws EINVAL).
//    The profile only holds the webview cache/localStorage; notes and settings live in
//    %APPDATA%\<identifier>\ (notes/*.md, meta.json, settings.json).
//
// Cross-platform safe: anything other than Windows exits successfully.
// NOTE: taskkill is called with stdio:'ignore' on purpose - capturing output needs a
//       pipe, which confined environments can refuse.
// ---------------------------------------------------------------------------
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
// Optional override, used by tests and available as an escape hatch for relocating the
// webview profile. Defaults to %LOCALAPPDATA%\<identifier>.
const override = (process.env.NOTEAPP_WEBVIEW_DIR || '').trim();
if (!override && !localAppData) {
  console.log('[prebuild] LOCALAPPDATA is not set; skipped the WebView2 profile reset.');
  process.exit(0);
}

const appDir = override || join(localAppData, identifier);
const profile = join(appDir, 'EBWebView');

if (!existsSync(profile)) {
  console.log('[prebuild] Stopped any running NoteApp; no WebView2 profile to clear.');
  process.exit(0);
}

let removed = 0;
let failed = 0;
try {
  for (const name of readdirSync(profile)) {
    try {
      rmSync(join(profile, name), { recursive: true, force: true });
      removed += 1;
    } catch (err) {
      failed += 1;
      console.log(`[prebuild] Could not remove ${name}: ${err.message}`);
    }
  }
} catch (err) {
  console.log(`[prebuild] Could not list ${profile}: ${err.message}`);
  console.log('[prebuild]   If the next launch shows no window, empty this folder by hand:');
  console.log(`[prebuild]   ${profile}`);
  process.exit(0);
}

console.log(`[prebuild] Cleared the WebView2 profile (${removed} entries removed${failed ? `, ${failed} failed` : ''})`);
console.log('[prebuild]   (webview cache only - your notes and settings are untouched)');
