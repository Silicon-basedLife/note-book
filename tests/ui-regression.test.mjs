// UI 回归测试：防止“hidden 属性被 display 样式覆盖”的问题复发。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const css = await readFile(resolve(ROOT, 'demo/styles.css'), 'utf8');
const html = await readFile(resolve(ROOT, 'demo/index.html'), 'utf8');

test('样式表存在强制 [hidden] 隐藏规则', () => {
  const rule = css.match(/\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;?\s*\}/);
  assert.ok(rule, 'styles.css 中应包含 [hidden] { display: none !important; }');
});

test('会按 hidden 属性切换的弹层/空状态元素都默认带 hidden', () => {
  assert.ok(html.includes('id="modal-mask" hidden'), 'modal-mask 应默认 hidden');
  assert.ok(html.includes('id="help-panel" hidden'), 'help-panel 应默认 hidden');
  assert.ok(html.includes('id="empty-editor" hidden'), 'empty-editor 应默认 hidden');
});
