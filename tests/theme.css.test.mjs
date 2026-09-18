// theme.css —— 主题样式契约：CSS 变量齐全、硬编码颜色受控、首屏引导脚本就位
// 目的：防止后续改动把颜色写回硬编码，导致深色主题出现“只变一半”的观感问题。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const css = await readFile(resolve(ROOT, 'web/src/main/app.css'), 'utf8');
const indexHtml = await readFile(resolve(ROOT, 'web/index.html'), 'utf8');
const settingsHtml = await readFile(resolve(ROOT, 'web/settings.html'), 'utf8');
const settingsSvelte = await readFile(resolve(ROOT, 'web/src/settings/Settings.svelte'), 'utf8');

/** 取某段 CSS 块（按出现顺序的第 n 个 { ... }），用花括号计数应对嵌套 */
function blockOf(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `未找到样式块：${marker}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`样式块未闭合：${marker}`);
}

const lightBlock = blockOf(css, ":root[data-theme='light']");
const darkBlock = blockOf(css, ":root[data-theme='dark']");
const varsIn = (block) => new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

/** 与主题无关、只需定义一次的变量（字体栈等，靠继承即可） */
const THEME_AGNOSTIC_VARS = new Set(['--mono']);

test('浅色与深色定义的是同一批 CSS 变量（避免某档漏项导致深色“半生效”）', () => {
  const light = varsIn(lightBlock);
  const dark = varsIn(darkBlock);
  const missingInDark = [...light].filter((v) => !dark.has(v) && !THEME_AGNOSTIC_VARS.has(v));
  const missingInLight = [...dark].filter((v) => !light.has(v));
  assert.deepEqual(missingInDark, [], `深色缺少变量：${missingInDark.join(', ')}`);
  assert.deepEqual(missingInLight, [], `浅色缺少变量：${missingInLight.join(', ')}`);
  assert.ok(light.size >= 40, `变量数量偏少（${light.size}），主题覆盖可能不完整`);
});

test('两个主题档都声明了 color-scheme（原生控件跟随）', () => {
  assert.match(lightBlock, /color-scheme:\s*light/);
  assert.match(darkBlock, /color-scheme:\s*dark/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)/, '应有系统深色兜底');
});

test('样式表里除变量定义与代码高亮外，不再有硬编码颜色', () => {
  const stripped = css
    .replace(blockOf(css, ':root,'), '')            // 浅色变量定义
    .replace(lightBlock, '')                        // 浅色变量定义（data-theme 版）
    .replace(darkBlock, '')                         // 深色变量定义
    .replace(blockOf(css, ':root:not([data-theme])'), '') // 系统兜底变量
    .replace(/\/\*[\s\S]*?\*\//g, '')               // 注释（含被注释掉的说明）
    .replace(/^\s*\.hljs[^\n]*$/gm, '');            // 代码块高亮配色（固定深底，不随主题）
  const offenders = stripped
    .split('\n')
    .map((line, i) => ({ line: line.trim(), no: i + 1 }))
    .filter(({ line }) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(line));
  assert.deepEqual(
    offenders.map((o) => o.line),
    [],
    '这些规则里出现了硬编码颜色，请改为 var(--token) 或加入白名单'
  );
});

test('设置窗口的样式同样只依赖主题变量', () => {
  const style = settingsSvelte.slice(settingsSvelte.indexOf('<style>'));
  const stripped = style
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\.theme-swatch[^\n]*$/gm, ''); // 主题色板示意块（本就该显示真实黑白）
  const offenders = stripped
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(line));
  assert.deepEqual(offenders, [], '设置窗口样式出现了硬编码颜色');
});

test('两个窗口的 HTML 都带首屏主题引导脚本（防深色用户白屏闪烁）', () => {
  for (const [name, html] of [['index.html', indexHtml], ['settings.html', settingsHtml]]) {
    assert.match(html, /documentElement\.dataset\.theme/, `${name} 缺少主题引导`);
    assert.match(html, /noteapp\.settings\.v1/, `${name} 引导未读取设置快照`);
    assert.ok(
      html.indexOf('dataset.theme') < html.indexOf('<script type="module"'),
      `${name} 引导脚本必须在模块脚本之前同步执行`
    );
  }
});
