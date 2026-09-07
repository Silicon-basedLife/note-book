// markdown 渲染器单元测试
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, escapeHtml, highlightCode } from '../demo/js/markdown.mjs';

test('HTML 注入被转义', () => {
  const { html } = renderMarkdown('你好 <script>alert(1)</script> & <b>x</b>');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;b&gt;'));
  assert.ok(html.includes('&amp;'));
});

test('标题 / 粗体 / 斜体 / 行内代码 / 链接', () => {
  const md = [
    '# 一级',
    '',
    '正文有 **加粗** 与 *斜体*，还有 `code()` 与 [链接](https://a.b)。',
  ].join('\n');
  const { html } = renderMarkdown(md);
  assert.ok(html.includes('<h1>一级</h1>'));
  assert.ok(html.includes('<strong>加粗</strong>'));
  assert.ok(html.includes('<em>斜体</em>'));
  assert.ok(html.includes('<code>code()</code>'));
  assert.ok(html.includes('<a href="https://a.b"'));
});

test('任务列表：生成 checkbox 与 data-offset，源文偏移正确', () => {
  const md = '- [ ] 待办一\n- [x] 待办二';
  const { html, tasks } = renderMarkdown(md);
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks, [
    { offset: 0, checked: false },
    { offset: 10, checked: true },
  ]);
  assert.ok(html.includes('data-offset="0"'));
  assert.ok(html.includes('checked'));
  assert.ok(html.includes('class="task done"'));
});

test('任务列表：正文前面的文字不影响偏移', () => {
  const md = '说明：两件小事\n\n- [ ] 第一件';
  const { tasks } = renderMarkdown(md);
  assert.equal(tasks.length, 1);
  assert.equal(md.slice(tasks[0].offset, tasks[0].offset + 6), '- [ ] ');
});

test('无序/有序列表与引用', () => {
  const { html } = renderMarkdown('- a\n- b\n\n1. x\n2. y\n\n> 引用');
  assert.ok(html.includes('<ul><li>a</li><li>b</li></ul>'));
  assert.ok(html.includes('<ol><li>x</li><li>y</li></ol>'));
  assert.ok(html.includes('<blockquote>'));
  assert.ok(html.includes('引用'));
});

test('代码块：围栏 + 高亮且不注入 HTML', () => {
  const { html } = renderMarkdown('```js\nconst x = 1; // hi\n```');
  assert.ok(html.includes('<pre class="code">'));
  assert.ok(html.includes('lang-js'));
  assert.ok(html.includes('tok-k')); // const 被高亮为关键字
  assert.ok(!html.includes('<script'));
});

test('highlightCode：未知语言回退为纯转义文本', () => {
  const out = highlightCode('nolang', '<div> & more');
  assert.ok(!out.includes('<div>'));
  assert.ok(out.includes('&lt;div&gt;'));
});

test('escapeHtml 基础转义', () => {
  assert.equal(escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});
