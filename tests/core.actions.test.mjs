// core.actions —— 动作注册表：注册/冲突/匹配
import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionRegistry } from '../web/src/lib/core/actions.ts';

function ev(over) {
  return { key: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over };
}

test('注册并命中快捷键动作（大小写不敏感、修饰键完全匹配）', () => {
  const reg = new ActionRegistry();
  let ran = 0;
  const r1 = reg.register({ id: 'focus-search', label: '聚焦搜索', shortcut: { key: 'k', ctrl: true }, run: () => { ran += 1; } });
  assert.equal(r1.ok, true);
  assert.equal(reg.match(ev({ key: 'k', ctrlKey: true }))?.id, 'focus-search');
  assert.equal(reg.match(ev({ key: 'K', ctrlKey: true }))?.id, 'focus-search'); // 大写同样命中
  assert.equal(reg.match(ev({ key: 'k' })), undefined); // 缺 Ctrl 不命中
  assert.equal(reg.match(ev({ key: 'k', ctrlKey: true, altKey: true })), undefined); // 多余修饰不命中
  reg.match(ev({ key: 'k', ctrlKey: true }))?.run();
  assert.equal(ran, 1);
});

test('无快捷键动作仅按 id 查询', () => {
  const reg = new ActionRegistry();
  reg.register({ id: 'help', label: '帮助', run: () => {} });
  assert.equal(reg.get('help')?.label, '帮助');
  assert.equal(reg.match(ev({ key: 'h' })), undefined);
});

test('重复 id / 快捷键冲突被拒绝并给出原因', () => {
  const reg = new ActionRegistry();
  reg.register({ id: 'new-note', label: '新建', shortcut: { key: 'n', alt: true }, run: () => {} });
  const dup = reg.register({ id: 'new-note', label: 'x', run: () => {} });
  assert.equal(dup.ok, false);
  assert.match(dup.reason, /已注册/);
  const clash = reg.register({ id: 'other', label: 'y', shortcut: { key: 'N', alt: true }, run: () => {} });
  assert.equal(clash.ok, false);
  assert.match(clash.reason, /冲突/);
  // 冲突不占用：释放后可重新注册
  reg.unregister('new-note');
  assert.equal(reg.register({ id: 'other', label: 'y', shortcut: { key: 'n', alt: true }, run: () => {} }).ok, true);
});

test('命名键（Escape/?）可注册与匹配', () => {
  const reg = new ActionRegistry();
  reg.register({ id: 'close', label: '关闭', shortcut: { key: 'Escape' }, run: () => {} });
  reg.register({ id: 'help', label: '帮助', shortcut: { key: '?' }, run: () => {} });
  assert.equal(reg.match(ev({ key: 'Escape' }))?.id, 'close');
  assert.equal(reg.match(ev({ key: '?' }))?.id, 'help');
});

test('list/unregister 行为', () => {
  const reg = new ActionRegistry();
  reg.register({ id: 'a', label: 'A', run: () => {} });
  reg.register({ id: 'b', label: 'B', shortcut: { key: 'b', ctrl: true }, run: () => {} });
  assert.equal(reg.list().length, 2);
  assert.equal(reg.unregister('a'), true);
  assert.equal(reg.list().length, 1);
  assert.equal(reg.unregister('a'), false);
  // 注销带快捷键的动作后不再命中
  reg.unregister('b');
  assert.equal(reg.match(ev({ key: 'b', ctrlKey: true })), undefined);
});
