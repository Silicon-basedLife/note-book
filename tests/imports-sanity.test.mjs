// 静态一致性：app.mjs 从 store.mjs / db.mjs 导入的每个符号都必须是真实导出
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const app = await readFile(resolve(ROOT, 'demo/js/app.mjs'), 'utf8');
const store = await readFile(resolve(ROOT, 'demo/js/store.mjs'), 'utf8');
const db = await readFile(resolve(ROOT, 'demo/js/db.mjs'), 'utf8');

function exportedNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  return names;
}

test('app.mjs 的 import 均可解析', () => {
  const storeExports = exportedNames(store);
  const dbExports = exportedNames(db);
  const storeImport = app.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/store\.mjs'/) || [];
  const dbImport = app.match(/import\s*\{([^}]*)\}\s*from\s*'\.\/db\.mjs'/) || [];
  const check = (block, exports, file) => {
    if (!block[1]) return;
    for (const name of block[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      assert.ok(exports.has(name), `app.mjs 导入的 ${name} 未在 ${file} 中导出`);
    }
  };
  check(storeImport, storeExports, 'store.mjs');
  check(dbImport, dbExports, 'db.mjs');
});
