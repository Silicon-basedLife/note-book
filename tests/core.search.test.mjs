// core.search —— 全文搜索：标题优先/片段高亮/转义安全/文件夹过滤/排序
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchIndex } from '../web/src/lib/core/search.ts';
import { entryFromDoc, plainTextOf, countByFolder } from '../web/src/lib/core/index.ts';
import { escapeHtml } from '../web/src/lib/core/html.ts';

function doc(over) {
  return {
    id: 'n-x', folder: '收件箱', title: '', tags: [], pinned: false,
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
    body: '', extra: [],
    ...over,
  };
}

test('空查询返回 null；无命中返回 []', () => {
  const entries = [entryFromDoc(doc({ id: 'n-1', title: '甲' }))];
  assert.equal(searchIndex(entries, '   '), null);
  assert.equal(searchIndex(entries, ''), null);
  assert.equal(searchIndex(entries, '不存在的词xyz').length, 0);
});

test('标题命中优先于正文命中，且高亮为 <mark>', () => {
  const entries = [
    entryFromDoc(doc({ id: 'n-old-title', title: 'Rust 学习', body: '无关', updatedAt: '2025-01-01T00:00:00.000Z' })),
    entryFromDoc(doc({ id: 'n-new-body', title: '周报', body: '正文提到 Rust 关键字', updatedAt: '2025-02-01T00:00:00.000Z' })),
  ];
  const hits = searchIndex(entries, 'Rust');
  assert.equal(hits.length, 2);
  assert.equal(hits[0].noteId, 'n-old-title'); // 即使更新时间更旧，标题命中仍优先
  assert.equal(hits[0].where, 'title');
  assert.ok(hits[0].snippet.includes('<mark>Rust</mark>'));
  assert.equal(hits[1].where, 'body');
  assert.ok(hits[1].snippet.includes('<mark>Rust</mark>'));
});

test('大小写不敏感命中，高亮保留原文大小写', () => {
  const entries = [entryFromDoc(doc({ id: 'n-1', body: 'Introducing Hello world.' }))];
  const hits = searchIndex(entries, 'hello');
  assert.ok(hits[0].snippet.includes('<mark>Hello</mark>'));
});

test('正文片段永不泄露未转义 HTML（XSS 防护）', () => {
  const evil = doc({
    id: 'n-evil',
    title: '正常标题',
    body: '前文 <script>alert(1)</script> 以及 <img src=x onerror=alert(2)> 正文危险词',
  });
  const entries = [entryFromDoc(evil)];
  const hits = searchIndex(entries, '危险词');
  assert.equal(hits.length, 1);
  assert.ok(!hits[0].snippet.includes('<script>'));
  assert.ok(!hits[0].snippet.includes('<img'));
  assert.ok(hits[0].snippet.includes('&lt;/script&gt;'));
  assert.ok(hits[0].snippet.includes('&lt;img'));
  assert.ok(hits[0].snippet.includes('<mark>危险词</mark>'));
});

test('folder 过滤：仅返回该文件夹内命中', () => {
  const entries = [
    entryFromDoc(doc({ id: 'n-w', folder: '工作', title: '联调', body: '' })),
    entryFromDoc(doc({ id: 'n-s', folder: '学习', title: '联调文档', body: '' })),
  ];
  const hits = searchIndex(entries, '联调', '工作');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].noteId, 'n-w');
  assert.equal(searchIndex(entries, '联调', '不存在').length, 0);
});

test('同级别命中按更新时间倒序', () => {
  const entries = [
    entryFromDoc(doc({ id: 'n-a', title: '甲', body: '关键词', updatedAt: '2025-01-01T00:00:00.000Z' })),
    entryFromDoc(doc({ id: 'n-b', title: '乙', body: '关键词', updatedAt: '2025-03-01T00:00:00.000Z' })),
    entryFromDoc(doc({ id: 'n-c', title: '丙', body: '关键词', updatedAt: '2025-02-01T00:00:00.000Z' })),
  ];
  const hits = searchIndex(entries, '关键词');
  assert.deepEqual(hits.map((h) => h.noteId), ['n-b', 'n-c', 'n-a']);
});

test('长正文片段被截断并加省略号', () => {
  const long = '甲'.repeat(400) + '关键词' + '乙'.repeat(200);
  const entries = [entryFromDoc(doc({ id: 'n-long', body: long }))];
  const hits = searchIndex(entries, '关键词');
  assert.equal(hits.length, 1);
  assert.ok(hits[0].snippet.includes('<mark>关键词</mark>'));
  assert.ok(hits[0].snippet.startsWith('…'));
  assert.ok(hits[0].snippet.endsWith('…'));
  assert.ok(hits[0].snippet.length < 400);
});

test('plainTextOf 剥离 markdown 符号、去掉代码围栏', () => {
  const md = '# 标题\n\n- [x] 任务 **加粗** `code`\n\n```js\nconst x = 1;\n```\n\n[链接](https://a.b) *斜体*';
  const t = plainTextOf(md);
  assert.ok(!t.includes('#'));
  assert.ok(!t.includes('**'));
  assert.ok(!t.includes('`'));
  assert.ok(!t.includes('const x = 1')); // 代码内容不进纯文本索引
  assert.ok(!t.includes(']('));
  assert.ok(t.includes('标题'));
  assert.ok(t.includes('任务'));
  assert.ok(t.includes('链接'));
});

test('countByFolder 统计', () => {
  const notes = [
    { folder: '收件箱' }, { folder: '收件箱' }, { folder: '工作' },
  ];
  assert.deepEqual(countByFolder(notes), { 收件箱: 2, 工作: 1 });
});

test('escapeHtml 基础转义', () => {
  assert.equal(escapeHtml('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});
