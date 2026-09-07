// core.markdown —— 渲染管线（markdown-it+GFM+高亮+清洗+待办注入/回写）
// 本套件是 demo/js/markdown.mjs 行为验收基线在新技术选型上的迁移版本。
import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, highlightCode, renderMarkdown, sanitizeHtml } from '../web/src/lib/core/markdown.ts';
import { toggleTask } from '../web/src/lib/core/tasks.ts';

test('HTML 注入被转义（脚本/标签原样展示）', () => {
  const { html } = renderMarkdown('你好 <script>alert(1)</script> & <b>x</b>');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;b&gt;'));
  assert.ok(html.includes('&amp;'));
});

test('标题 / 粗体 / 斜体 / 行内代码 / 链接', () => {
  const { html } = renderMarkdown('# 一级\n\n正文有 **加粗** 与 *斜体*，还有 `code()` 与 [链接](https://a.b)。');
  assert.ok(html.includes('<h1>一级</h1>'));
  assert.ok(html.includes('<strong>加粗</strong>'));
  assert.ok(html.includes('<em>斜体</em>'));
  assert.ok(html.includes('<code>code()</code>'));
  assert.ok(html.includes('<a href="https://a.b"'));
});

test('任务列表：生成带 data-offset 的 checkbox，源文偏移可回写', () => {
  const md = '- [ ] 待办一\n- [x] 待办二';
  const { html, tasks } = renderMarkdown(md);
  assert.equal(tasks.length, 2);
  assert.deepEqual(tasks, [
    { offset: 0, checked: false },
    { offset: 10, checked: true },
  ]);
  assert.ok(html.includes('data-offset="0"'));
  assert.ok(html.includes('class="task-check"'));
  assert.ok(/checked(?:\s|>)/.test(html));
  // 偏移语义：offset 指向任务行 "-"，toggleTask 以 offset+3 翻转勾选位
  for (const t of tasks) {
    assert.match(md.slice(t.offset, t.offset + 6), /^[-*] \[[ xX]\]/);
  }
  const toggled = toggleTask(md, tasks[0].offset);
  assert.equal(toggled, '- [x] 待办一\n- [x] 待办二');
});

test('任务列表：正文前面的文字不影响偏移', () => {
  const md = '说明：两件小事\n\n- [ ] 第一件';
  const { tasks } = renderMarkdown(md);
  assert.equal(tasks.length, 1);
  assert.equal(md.slice(tasks[0].offset, tasks[0].offset + 6), '- [ ] ');
});

test('任务列表：引用内/嵌套列表的偏移依旧指向源文 "-"', () => {
  const md = '> - [ ] 引用任务\n\n- [ ] 一级\n  - [ ] 二级';
  const { tasks } = renderMarkdown(md);
  assert.equal(tasks.length, 3);
  for (const t of tasks) assert.match(md.slice(t.offset, t.offset + 6), /^[-*] \[[ xX]\]/);
  // 有序列表中的 "[ ]" 文本不是任务
  const ordered = renderMarkdown('1. 有序 [ ] 不是任务');
  assert.equal(ordered.tasks.length, 0);
  assert.ok(ordered.html.includes('[ ] 不是任务'));
});

test('无序/有序列表与引用', () => {
  const { html } = renderMarkdown('- a\n- b\n\n1. x\n2. y\n\n> 引用');
  assert.ok(html.includes('<ul>'));
  assert.ok(html.includes('<li>a</li>'));
  assert.ok(html.includes('<ol>'));
  assert.ok(html.includes('<li>x</li>'));
  assert.ok(html.includes('<blockquote>'));
  assert.ok(html.includes('引用'));
});

test('代码块：围栏 + hljs 高亮且不注入 HTML', () => {
  const { html } = renderMarkdown('```js\nconst x = 1; // hi\n```');
  assert.ok(html.includes('<pre class="code">'));
  assert.ok(html.includes('lang-js'));
  assert.ok(html.includes('hljs-keyword')); // const 高亮为关键字
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

test('GFM：表格 / 删除线 / 自动链接', () => {
  const { html } = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |\n\n~~删除~~ 见 https://a.b');
  assert.ok(html.includes('<table>'));
  assert.ok(html.includes('<td>1</td>'));
  assert.ok(html.includes('<s>删除</s>'));
  assert.ok(html.includes('<a href="https://a.b">https://a.b</a>'));
});

test('危险协议链接不可点击：javascript: 保持为纯文本', () => {
  const { html } = renderMarkdown('[bad](javascript:alert(1)) 和 [ok](https://safe.example)');
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('href="https://safe.example"'));
});

test('sanitizeHtml：白名单剔除脚本与事件属性，保留受控标签', () => {
  const dirty =
    '<script>alert(1)</script><p onclick="x()">正文<a href="javascript:y()">a</a>' +
    '<img src="https://x/y.png" onerror="z()" alt="图">' +
    '<span class="hljs-keyword">k</span><input class="task-check" data-offset="3" type="checkbox" checked></p>';
  const out = sanitizeHtml(dirty);
  assert.ok(!out.includes('<script'));
  assert.ok(!out.includes('onclick'));
  assert.ok(!out.includes('onerror'));
  assert.ok(!out.includes('javascript:'));
  assert.ok(out.includes('<p>正文'));
  assert.ok(out.includes('<span class="hljs-keyword">k</span>'));
  assert.ok(out.includes('data-offset="3"'));
  assert.ok(out.includes('<img src="https://x/y.png"'));
  assert.ok(out.includes(' checked'));
});

test('renderMarkdown 输出整体过白名单（组合攻击样例）', () => {
  const evil =
    '<img src=x onerror=alert(1)>\n\n```html\n<script>alert(2)</script>\n```\n\n<a href="javascript:x">点我</a> 与 ~~真删除~~';
  const { html } = renderMarkdown(evil);
  // 原始 <img>/<script> 被转义成文本，不产生真实标签
  assert.ok(html.includes('&lt;img'));
  assert.ok(!/<img[\s>]/i.test(html));
  assert.ok(!/<script[\s>]/i.test(html));
  assert.ok(!/href="javascript:/i.test(html));
  // 不存在任何事件类属性（白名单层）
  assert.ok(!/<[a-z][^>]*\son[a-z]+=/i.test(html));
  // 高亮后的代码块仍被保留为受控 <pre>/<code>
  assert.ok(html.includes('<pre class="code">'));
});
