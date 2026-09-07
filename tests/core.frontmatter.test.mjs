// core.frontmatter —— 文件 frontmatter 解析/序列化往返
import test from 'node:test';
import assert from 'node:assert/strict';
import { docFromContent, serializeDoc, splitFrontmatter } from '../web/src/lib/core/frontmatter.ts';

const NOW = '2025-06-10T09:00:00.000Z';

test('TECH_DESIGN 示例文件可完整解析', () => {
  const content = [
    '---',
    'id: n-xxxxxxxx',
    'folder: 收件箱',
    'title: 示例笔记',
    'tags: []',
    'pinned: false',
    'createdAt: 2026-09-07T10:00:00.000Z',
    'updatedAt: 2026-09-07T10:00:00.000Z',
    '---',
    '# 示例笔记',
    '正文……',
  ].join('\n');
  const doc = docFromContent(content, { fallbackId: 'n-fallback', nowIso: NOW });
  assert.equal(doc.id, 'n-xxxxxxxx');
  assert.equal(doc.folder, '收件箱');
  assert.equal(doc.title, '示例笔记');
  assert.deepEqual(doc.tags, []);
  assert.equal(doc.pinned, false);
  assert.equal(doc.body, '# 示例笔记\n正文……');
});

test('serialize → split 往返无损（含 tags/pinned/extra 扩展字段）', () => {
  const doc = {
    id: 'n-abc123',
    folder: '学习',
    title: '往返测试',
    tags: ['a', 'b'],
    pinned: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
    body: '第一行\n\n- [ ] 任务\n```js\ncode\n```',
    extra: [
      { key: 'custom-field', value: 'v1' },
      { key: 'order', value: '2' },
    ],
  };
  const content = serializeDoc(doc);
  const { entries, body } = splitFrontmatter(content);
  assert.ok(entries, '应有 frontmatter');
  assert.equal(body, doc.body, '正文逐字节保留');
  const keys = entries.map((e) => e.key);
  // 规范字段在前、顺序稳定；扩展字段原样保留且不重复
  assert.deepEqual(keys.slice(0, 7), ['id', 'folder', 'title', 'tags', 'pinned', 'createdAt', 'updatedAt']);
  assert.deepEqual(keys.slice(7), ['custom-field', 'order']);
  const back = docFromContent(content, { fallbackId: 'x', nowIso: NOW });
  assert.deepEqual(back, doc);
});

test('无 frontmatter：整篇视为正文并回退默认值', () => {
  const raw = '# 只有正文\n没有元数据';
  const { entries, body } = splitFrontmatter(raw);
  assert.equal(entries, null);
  assert.equal(body, raw);
  const doc = docFromContent(raw, { fallbackId: 'n-file1', nowIso: NOW });
  assert.equal(doc.id, 'n-file1');
  assert.equal(doc.folder, '收件箱');
  assert.equal(doc.title, '');
  assert.equal(doc.createdAt, NOW);
  assert.equal(doc.body, raw);
});

test('未闭合的 --- 开头不算 frontmatter', () => {
  const raw = '---\nid: n-1\n正文';
  const { entries } = splitFrontmatter(raw);
  assert.equal(entries, null);
});

test('tags 与 pinned 的类型解析', () => {
  const content = '---\nid: n-1\ntags: ["学习", "Rust"]\npinned: true\n---\n正文';
  const doc = docFromContent(content, { fallbackId: 'n-1', nowIso: NOW });
  assert.deepEqual(doc.tags, ['学习', 'Rust']);
  assert.equal(doc.pinned, true);
});

test('字段值里的换行会被清洗为单行，非法日期回退', () => {
  const content = [
    '---',
    'id: n-1',
    'title: 两行\n标题',
    'createdAt: not-a-date',
    'updatedAt: 2025-01-01T00:00:00.000Z',
    '---',
    '正文',
  ].join('\n');
  const doc = docFromContent(content, { fallbackId: 'n-1', nowIso: NOW });
  // 换行后的“标题”无 key 结构，不作为字段值；title 仅取首行
  assert.equal(doc.title, '两行');
  assert.equal(doc.createdAt, NOW);
  // 序列化出的 title 永不包含换行
  const out = serializeDoc({ ...doc, extra: [] });
  const back = docFromContent(out, { fallbackId: 'n-1', nowIso: NOW });
  assert.equal(back.title, '两行');
  assert.ok(!out.split('\n').some((l) => l.startsWith('title: ') && l.includes('\r')));
});
