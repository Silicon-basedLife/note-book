// core.storage-info —— 存储信息字段契约（前端归一化 + Rust camelCase 序列化）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { normalizeStorageInfo } from '../web/src/lib/settings/storage-info.ts';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('normalizeStorageInfo：camelCase 与 snake_case 都能解析', () => {
  const camel = normalizeStorageInfo({
    appVersion: '0.1.0', dataDir: 'C:/data', notesDir: 'C:/data/notes',
    defaultNotesDir: 'C:/data/notes', settingsFile: 'C:/data/settings.json', isCustom: true,
  });
  assert.equal(camel.notesDir, 'C:/data/notes');
  assert.equal(camel.isCustom, true);

  const snake = normalizeStorageInfo({
    app_version: '0.1.0', data_dir: 'C:/data', notes_dir: 'C:/data/notes',
    default_notes_dir: 'C:/data/notes', settings_file: 'C:/data/settings.json', is_custom: false,
  });
  assert.deepEqual(snake, {
    appVersion: '0.1.0', dataDir: 'C:/data', notesDir: 'C:/data/notes',
    defaultNotesDir: 'C:/data/notes', settingsFile: 'C:/data/settings.json', isCustom: false,
  });
});

test('normalizeStorageInfo：缺字段/垃圾输入回退空串，不抛错', () => {
  const info = normalizeStorageInfo(null);
  assert.equal(info.notesDir, '');
  assert.equal(info.isCustom, false);
  assert.equal(normalizeStorageInfo({ notesDir: 42 }).notesDir, '');
});

test('Rust StorageInfo 契约：camelCase 序列化且字段名与前端一致', async () => {
  const rust = await readFile(resolve(ROOT, 'src-tauri/src/fs_store.rs'), 'utf8');
  const idx = rust.indexOf('pub struct StorageInfo');
  assert.ok(idx > 0, '应能找到 StorageInfo 结构体');
  const head = rust.slice(Math.max(0, idx - 120), idx);
  assert.ok(
    /#\[serde\(rename_all = "camelCase"\)\]/.test(head),
    'StorageInfo 必须使用 #[serde(rename_all = "camelCase")]，否则前端 camelCase 字段读不到'
  );
  const block = rust.slice(idx, rust.indexOf('}', idx));
  for (const field of ['app_version', 'data_dir', 'notes_dir', 'default_notes_dir', 'settings_file', 'is_custom']) {
    assert.ok(block.includes(field + ':'), `StorageInfo 应包含字段 ${field}`);
  }
});

test('Rust 路径展示：剥离 verbatim 前缀，且存储信息/迁移指针统一走 display_path', async () => {
  const rust = await readFile(resolve(ROOT, 'src-tauri/src/fs_store.rs'), 'utf8');
  assert.ok(rust.includes('fn clean_verbatim'), '应有 clean_verbatim 去掉 \\\\?\\ 前缀');
  assert.ok(rust.includes('fn display_path'), '应有 display_path 包装');
  assert.ok(rust.includes('data_dir: display_path(&base)'), 'data_dir 应经 display_path');
  assert.ok(rust.includes('notes_dir: display_path(&notes)'), 'notes_dir 应经 display_path');
  assert.ok(rust.includes('display_path(&dest_abs)'), '迁移写入的 notesDir 应为普通绝对路径');
  assert.ok(rust.includes('fn same_path'), '应能判断指针是否指向默认目录（清理冗余 storage.json）');
});
