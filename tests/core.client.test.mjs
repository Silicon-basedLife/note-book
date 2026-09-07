// core-client 展示辅助（displayTitle/excerptOf）
import test from 'node:test';
import assert from 'node:assert/strict';
import { displayTitle, excerptOf } from '../web/src/shared/core-client.ts';

test('displayTitle：空标题回退为占位文案', () => {
  assert.equal(displayTitle({ title: '' }), '无标题笔记');
  assert.equal(displayTitle({ title: '   ' }), '无标题笔记');
  assert.equal(displayTitle({ title: '真实标题' }), '真实标题');
});

test('excerptOf：压缩空白并截断加省略号', () => {
  assert.equal(excerptOf('  普通   文本  '), '普通 文本');
  const long = '甲'.repeat(80);
  const out = excerptOf(long, 64);
  assert.equal(out.length, 65); // 64 + 省略号
  assert.ok(out.endsWith('…'));
  assert.equal(excerptOf('短的', 64), '短的');
});
