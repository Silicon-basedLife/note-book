// scripts/postbuild-unblock.mjs
// ---------------------------------------------------------------------------
// Runs after every desktop build (via npm "post" hooks) to make the produced exe
// launchable by a plain double-click.
//
// WHY: Explorer shows
//        "打开文件 - 安全警告 / 无法验证发布者。你确定要运行此软件吗？"
//      for an UNSIGNED executable that carries a Mark-of-the-Web (the
//      ":Zone.Identifier" alternate data stream). That dialog has a "发送方"
//      field and says "此文件没有包含有效的数字签名" - it is NOT a code error and
//      clicking 取消 simply never starts the app (users read it as "软件打不开").
//      A freshly built exe normally has no MOTW, but one can appear on it (e.g.
//      after a security product quarantines and restores the file), so we strip it
//      unconditionally after each build. This is the same as right-click ->
//      Properties -> Unblock, or PowerShell's Unblock-File.
//
// Notes:
// - Deleting an alternate data stream is done by unlinking "<file>:<stream>".
// - Safe to run when there is no stream, and on non-Windows it exits silently.
// ---------------------------------------------------------------------------
import { existsSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  join(root, 'src-tauri', 'target', 'release', 'noteapp.exe'),
  join(root, 'src-tauri', 'target', 'debug', 'noteapp.exe'),
];

let seen = 0;
for (const exe of candidates) {
  if (!existsSync(exe)) continue;
  seen += 1;
  const stream = `${exe}:Zone.Identifier`;
  try {
    unlinkSync(stream);
    console.log(`[postbuild] Removed the Mark-of-the-Web from ${exe}`);
    console.log('[postbuild]   (without this, double-clicking shows "无法验证发布者")');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log(`[postbuild] ${exe}: no Mark-of-the-Web (nothing to do)`);
    } else {
      console.log(`[postbuild] ${exe}: could not remove the Mark-of-the-Web: ${err.message}`);
      console.log('[postbuild]   Workaround: right-click the exe -> Properties -> check "Unblock"');
    }
  }
}

if (seen === 0) {
  console.log('[postbuild] No built exe found; skipped the Mark-of-the-Web check.');
}
