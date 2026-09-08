// UI 回归测试：防止 hidden 属性被 display 覆盖的问题复发，并校验关键 DOM id 一致性
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const css = await readFile(resolve(ROOT, 'demo/styles.css'), 'utf8');
const html = await readFile(resolve(ROOT, 'demo/index.html'), 'utf8');
const app = await readFile(resolve(ROOT, 'demo/js/app.mjs'), 'utf8');

test('样式表存在强制 [hidden] 隐藏规则', () => {
  const rule = css.match(/\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/);
  assert.ok(rule, 'styles.css 中应包含 [hidden] { display: none !important; }');
});

test('默认隐藏的弹层/空状态都带 hidden 属性', () => {
  for (const id of ['modal-mask', 'help-panel', 'empty-editor', 'ctx-menu']) {
    const re = new RegExp(`id="${id}"[^>]*\\shidden`);
    assert.ok(re.test(html), `${id} 应默认 hidden`);
  }
});

test('app.mjs 引用的所有 DOM id 都存在于 index.html', () => {
  const refs = [...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  const missing = refs.filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `index.html 缺少这些 id: ${missing.join(', ')}`);
});

test('页面包含核心结构：树/回收站/内容区/靠边隐藏', () => {
  for (const id of ['tree', 'bin-wrap', 'nav-scroll', 'search-input', 'editor', 'preview', 'dock-bar', 'dock-toggle', 'note-banner']) {
    assert.ok(html.includes(`id="${id}"`), `缺少 id="${id}"`);
  }
  assert.ok(html.includes('回收站'));
});
