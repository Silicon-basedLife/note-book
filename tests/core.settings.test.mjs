// core.settings —— 设置归一化、未知字段保留、快捷键生效/冲突
import test from 'node:test';
import assert from 'node:assert/strict';
import { coerceSettings, preservedMerge } from '../web/src/lib/settings/coerce.ts';
import { DEFAULT_SETTINGS } from '../web/src/lib/settings/types.ts';
import {
  effectiveShortcuts, findShortcutConflict, formatShortcut, isShortcutAllowed, shortcutSignature,
} from '../web/src/lib/settings/shortcuts.ts';

test('coerceSettings：空/垃圾输入回退默认', () => {
  assert.deepEqual(coerceSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(coerceSettings('oops'), DEFAULT_SETTINGS);
  assert.deepEqual(coerceSettings({ general: 3 }), DEFAULT_SETTINGS);
});

test('coerceSettings：非法枚举与越界数值被纠正', () => {
  const s = coerceSettings({
    version: 99,
    general: { startLayout: 'fig9', rememberPanels: 'yes' },
    editor: { defaultMode: 'x', autoSaveMs: 99999, spellcheck: true },
    dock: { enabled: false, side: 'up', hideDelayMs: 10, topmost: false, hotZonePx: 999, onlySidebar: false },
  });
  assert.equal(s.version, DEFAULT_SETTINGS.version); // 版本号以当前为准
  assert.equal(s.general.startLayout, 'fig3');
  assert.equal(s.general.rememberPanels, false);
  assert.equal(s.editor.defaultMode, 'split');
  assert.equal(s.editor.autoSaveMs, 2000); // 夹到上限
  assert.equal(s.editor.spellcheck, true);
  assert.equal(s.dock.side, 'both');
  assert.equal(s.dock.hideDelayMs, 1000);  // 夹到下限
  assert.equal(s.dock.hotZonePx, 40);
  assert.equal(s.dock.enabled, false);
});

test('coerceSettings：快捷键清洗（保留 null 禁用、丢弃非法）', () => {
  const s = coerceSettings({
    shortcuts: {
      'new-note': { key: 'N', alt: true, junk: 1 },
      'save-now': null,
      'bad-key': { key: '' },
      'not-object': 42,
    },
  });
  assert.deepEqual(s.shortcuts['new-note'], { key: 'N', alt: true });
  assert.equal(s.shortcuts['save-now'], null);
  assert.equal('bad-key' in s.shortcuts, false);
  assert.equal('not-object' in s.shortcuts, false);
});

test('preservedMerge：未知字段（未来版本/手工添加）不被丢弃', () => {
  const prev = {
    version: 1,
    general: { startLayout: 'fig3', futureFlag: 'keep-me' },
    dock: { enabled: true, futureDock: 7 },
    shortcuts: { 'new-note': { key: 'n', alt: true } },
    brandNewTop: { hello: 'world' },
  };
  const next = coerceSettings({ general: { startLayout: 'fig5', rememberPanels: true }, editor: { autoSaveMs: 900 } });
  const merged = preservedMerge(prev, next);
  assert.equal(merged.brandNewTop.hello, 'world');       // 顶层未知保留
  assert.equal(merged.general.futureFlag, 'keep-me');     // 组内未知保留
  assert.equal(merged.dock.futureDock, 7);
  assert.equal(merged.general.startLayout, 'fig5');       // 已知项被更新
  assert.equal(merged.editor.autoSaveMs, 900);
});

test('preservedMerge：lastPanels 可写可清', () => {
  const base = coerceSettings({});
  const withPanels = preservedMerge({}, { ...base, lastPanels: { listOpen: true, editorOpen: false, folder: '工作' } });
  assert.deepEqual(withPanels.lastPanels, { listOpen: true, editorOpen: false, folder: '工作' });
  const cleared = preservedMerge(withPanels, base);
  assert.equal('lastPanels' in cleared, false);
});

test('effectiveShortcuts：覆盖优先、null 表示禁用、缺省用默认', () => {
  const eff = effectiveShortcuts({ 'new-note': { key: 'm', alt: true }, 'help': null });
  assert.deepEqual(eff['new-note'], { key: 'm', alt: true });
  assert.equal(eff['help'], null);
  assert.deepEqual(eff['focus-search'], { key: 'k', ctrl: true });
});

test('findShortcutConflict：重复键位提示；不同修饰键不冲突；禁用项不参与', () => {
  const overrides = {};
  assert.equal(findShortcutConflict('save-now', { key: 'k', ctrl: true }, overrides), '聚焦搜索');
  assert.equal(findShortcutConflict('save-now', { key: 'k', ctrl: true, shift: true }, overrides), null);
  assert.equal(findShortcutConflict('save-now', { key: 's', ctrl: true }, overrides), null); // 自定义自身为默认值
  assert.equal(findShortcutConflict('new-note', { key: 'k', ctrl: true }, { 'focus-search': null }), null);
  assert.equal(findShortcutConflict('save-now', null, overrides), null);
});

test('键位格式化与合法性', () => {
  assert.equal(formatShortcut({ key: 'k', ctrl: true }), 'Ctrl + K');
  assert.equal(formatShortcut({ key: '?', shift: true }), 'Shift + ?');
  assert.equal(formatShortcut(null), '未设置');
  assert.equal(shortcutSignature({ key: 'K', ctrl: true }), shortcutSignature({ key: 'k', ctrl: true }));
  assert.equal(isShortcutAllowed({ key: 'k', ctrl: true }), true);
  assert.equal(isShortcutAllowed({ key: '?', shift: true }), false); // 仅 Shift 不允许自定义
});
