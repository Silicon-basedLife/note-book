// core.theme —— 主题：设置归一化 + 解析纯逻辑 + DOM 应用（不依赖真实浏览器）
import test from 'node:test';
import assert from 'node:assert/strict';
import { coerceSettings, preservedMerge } from '../web/src/lib/settings/coerce.ts';
import { DEFAULT_SETTINGS, THEME_MODES } from '../web/src/lib/settings/types.ts';
import {
  applyCachedTheme,
  applyTheme,
  applyThemeMode,
  readCachedThemeMode,
  resolveTheme,
  SETTINGS_LS_KEY,
  systemPrefersDark,
} from '../web/src/lib/desktop/theme.ts';

/** 最小 document 替身：只暴露 applyTheme 会用到的 documentElement */
function fakeDoc() {
  return { documentElement: { dataset: {}, style: {} } };
}

test('coerceSettings：主题默认浅色、合法值保留、非法值回退', () => {
  assert.deepEqual(coerceSettings(null).general.theme, 'light');
  assert.equal(DEFAULT_SETTINGS.general.theme, 'light');
  for (const m of THEME_MODES) {
    assert.equal(coerceSettings({ general: { theme: m } }).general.theme, m);
  }
  assert.equal(coerceSettings({ general: { theme: 'solarized' } }).general.theme, 'light');
  assert.equal(coerceSettings({ general: { theme: 3 } }).general.theme, 'light');
  assert.equal(coerceSettings({ general: { theme: null } }).general.theme, 'light');
});

test('preservedMerge：主题可写，且同一分组里的未知字段仍被保留', () => {
  const merged = preservedMerge(
    { general: { theme: 'light', futureGeneral: 'keep' } },
    coerceSettings({ general: { theme: 'dark' } })
  );
  assert.equal(merged.general.theme, 'dark');
  assert.equal(merged.general.futureGeneral, 'keep');
});

test('resolveTheme：显式浅/深不受系统影响；system 跟随系统且缺省按浅色', () => {
  assert.equal(resolveTheme('light', { prefersDark: true }), 'light');
  assert.equal(resolveTheme('light', { prefersDark: false }), 'light');
  assert.equal(resolveTheme('dark', { prefersDark: false }), 'dark');
  assert.equal(resolveTheme('system', { prefersDark: true }), 'dark');
  assert.equal(resolveTheme('system', { prefersDark: false }), 'light');
  assert.equal(resolveTheme('system'), 'light'); // 未提供环境信息 → 浅色
  assert.equal(resolveTheme('system', {}), 'light');
});

test('applyTheme：写 data-theme 与 color-scheme；非法值不动 DOM', () => {
  const doc = fakeDoc();
  applyTheme('dark', doc);
  assert.equal(doc.documentElement.dataset.theme, 'dark');
  assert.equal(doc.documentElement.style.colorScheme, 'dark');

  applyTheme('light', doc);
  assert.equal(doc.documentElement.dataset.theme, 'light');
  assert.equal(doc.documentElement.style.colorScheme, 'light');

  const before = JSON.stringify(doc.documentElement);
  applyTheme('sepia', doc);
  assert.equal(JSON.stringify(doc.documentElement), before);
});

test('applyTheme：没有文档（node 环境）时静默返回，不抛错', () => {
  assert.doesNotThrow(() => applyTheme('dark', null));
  assert.doesNotThrow(() => applyTheme('dark'));
});

test('systemPrefersDark：无 window/matchMedia 时按浅色处理', () => {
  assert.equal(typeof window, 'undefined'); // node:test 环境没有 window
  assert.equal(systemPrefersDark(), false);
});

test('readCachedThemeMode：无 localStorage 返回 undefined；快照可读且容错', () => {
  assert.equal(readCachedThemeMode(), undefined);

  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  };
  try {
    assert.equal(readCachedThemeMode(), undefined); // 无快照

    store.set(SETTINGS_LS_KEY, 'not json');
    assert.equal(readCachedThemeMode(), undefined); // 坏 JSON 不抛错

    store.set(SETTINGS_LS_KEY, JSON.stringify({ general: { theme: 'dark' } }));
    assert.equal(readCachedThemeMode(), 'dark');

    store.set(SETTINGS_LS_KEY, JSON.stringify({ general: { theme: 'system' } }));
    assert.equal(readCachedThemeMode(), 'system');

    store.set(SETTINGS_LS_KEY, JSON.stringify({ general: { theme: 'weird' } }));
    assert.equal(readCachedThemeMode(), 'light'); // 归一化后回退默认，仍是可用的模式
  } finally {
    delete globalThis.localStorage;
  }
});

test('applyCachedTheme：有快照→应用；无快照→不写 DOM（留给 CSS 媒体查询兜底）', () => {
  const doc = fakeDoc();
  const prevDoc = globalThis.document;
  globalThis.document = doc;
  try {
    assert.equal(applyCachedTheme(), undefined); // 无 localStorage 快照
    assert.equal('theme' in doc.documentElement.dataset, false);

    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, v); },
      removeItem: (k) => { store.delete(k); },
    };
    store.set(SETTINGS_LS_KEY, JSON.stringify({ general: { theme: 'dark' } }));
    assert.equal(applyCachedTheme(), 'dark');
    assert.equal(doc.documentElement.dataset.theme, 'dark');
  } finally {
    delete globalThis.localStorage;
    if (prevDoc === undefined) delete globalThis.document;
    else globalThis.document = prevDoc;
  }
});

test('applyThemeMode：按模式解析并应用（node 环境无 document 也不抛错）', () => {
  assert.equal(applyThemeMode('light'), 'light');
  assert.equal(applyThemeMode('system'), 'light'); // 无 matchMedia → 浅色
});
