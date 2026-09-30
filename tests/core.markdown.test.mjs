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

// ---------- 高亮 ==文字==（格式工具栏的渲染侧支持） ----------

test('高亮：==文字== 渲染为 <mark>', () => {
  const { html } = renderMarkdown('这是 ==重点== 内容');
  assert.ok(html.includes('<mark>重点</mark>'), html);
});

test('高亮：高亮内部仍可嵌套其它行内语法', () => {
  const { html } = renderMarkdown('==**粗体在高亮里**==');
  assert.ok(html.includes('<mark><strong>粗体在高亮里</strong></mark>'), html);
});

test('高亮：未闭合的 == 按普通文本输出，不吞掉后续内容', () => {
  const { html } = renderMarkdown('不闭合的 ==高亮');
  assert.ok(html.includes('==高亮'));
  assert.ok(!html.includes('<mark>'));
});

test('高亮：行内代码里的 == 不被当作高亮', () => {
  const { html } = renderMarkdown('代码 `==x==` 里不高亮');
  assert.ok(html.includes('<code>==x==</code>'), html);
  assert.ok(!html.includes('<mark>'));
});

test('高亮：与删除线/粗体混用互不干扰', () => {
  const { html } = renderMarkdown('~~删~~ 与 **粗** 与 ==亮==');
  assert.ok(html.includes('<s>删</s>'));
  assert.ok(html.includes('<strong>粗</strong>'));
  assert.ok(html.includes('<mark>亮</mark>'));
});

test('高亮：<mark> 属于白名单标签，能穿过清洗', () => {
  const { html } = renderMarkdown('==x==');
  assert.ok(html.includes('<mark>x</mark>'));
});

// ---------- 换行：hardBreaks（默认开启，对应设置项「回车即换行」） ----------

const BREAK_SRC = 'vocabulary n. 词汇\nrotating n. 旋转\nPacific n. 太平洋';

test('换行：默认（hardBreaks 开启）单个回车渲染成 <br>', () => {
  const { html } = renderMarkdown(BREAK_SRC);
  assert.ok(html.includes('<br>'), html);
  // 行与行之间是真正的换行（<br> 后可能跟一个源码换行符）
  assert.match(html, /词汇<br>\s*rotating/, html);
  // 仍然是一个段落，没有额外段间距
  assert.equal((html.match(/<p>/g) ?? []).length, 1);
});

test('换行：显式 hardBreaks:true 与默认一致', () => {
  assert.equal(renderMarkdown(BREAK_SRC, { hardBreaks: true }).html, renderMarkdown(BREAK_SRC).html);
});

test('换行：hardBreaks:false 时按严格 CommonMark 折叠进同一段落（行间退化成空格）', () => {
  const { html } = renderMarkdown(BREAK_SRC, { hardBreaks: false });
  assert.ok(!html.includes('<br>'), html);
  // 只剩源码换行符 → HTML 里渲染成空格，这正是用户看到的“几行被拼成一句”
  assert.match(html, /词汇\s+rotating/, html);
  assert.equal((html.match(/<p>/g) ?? []).length, 1);
});

test('换行：空行分段在两种模式下都生效（互不干扰）', () => {
  const src = '第一段\n\n第二段';
  for (const hardBreaks of [true, false]) {
    const { html } = renderMarkdown(src, { hardBreaks });
    assert.equal((html.match(/<p>/g) ?? []).length, 2, `hardBreaks=${hardBreaks}`);
  }
});

test('换行：标题/列表/引用/代码块不受 hardBreaks 影响', () => {
  const src = '# 标题\n\n- 甲\n- 乙\n\n> 引用\n\n```js\nconst a = 1;\n```';
  for (const hardBreaks of [true, false]) {
    const { html } = renderMarkdown(src, { hardBreaks });
    assert.ok(html.includes('<h1>标题</h1>'), `hardBreaks=${hardBreaks}`);
    assert.equal((html.match(/<li>/g) ?? []).length, 2, `hardBreaks=${hardBreaks}`);
    assert.ok(html.includes('<blockquote>'), `hardBreaks=${hardBreaks}`);
    assert.ok(html.includes('<pre class="code">'), `hardBreaks=${hardBreaks}`);
  }
});

test('换行：两种模式各用一个渲染器实例，切换不互相污染', () => {
  const a1 = renderMarkdown(BREAK_SRC).html;
  const b1 = renderMarkdown(BREAK_SRC, { hardBreaks: false }).html;
  const a2 = renderMarkdown(BREAK_SRC).html;
  const b2 = renderMarkdown(BREAK_SRC, { hardBreaks: false }).html;
  assert.equal(a1, a2);
  assert.equal(b1, b2);
  assert.notEqual(a1, b1);
});

test('换行：待办任务的 data-offset 在两种模式下都不受影响', () => {
  const src = '说明\n- [ ] 甲\n- [x] 乙';
  for (const hardBreaks of [true, false]) {
    const { tasks } = renderMarkdown(src, { hardBreaks });
    assert.equal(tasks.length, 2, `hardBreaks=${hardBreaks}`);
    assert.equal(tasks[0].checked, false);
    assert.equal(tasks[1].checked, true);
  }
});
