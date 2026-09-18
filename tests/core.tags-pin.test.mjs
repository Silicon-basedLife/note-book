// core.tags-pin —— 标签规范化 + 置顶排序（数据层，纯逻辑）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countTags, hasTag, MAX_TAG_LEN, mergeTags, normalizeTag, parseTagInput, removeTag,
} from '../web/src/lib/core/tags.ts';
import { entryFromDoc } from '../web/src/lib/core/index.ts';
import { NoteCore } from '../web/src/lib/core/store.ts';
import { MemoryStorage } from '../web/src/lib/core/storage/memory.ts';
import { serializeDoc } from '../web/src/lib/core/frontmatter.ts';

let t = Date.parse('2025-05-01T00:00:00.000Z');
const clock = () => (t += 1000);

function doc(over = {}) {
  return {
    id: 'n-1', folder: '收件箱', title: 'x', tags: [], pinned: false,
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z',
    body: '', extra: [], ...over,
  };
}

function contentFor(over = {}) {
  return serializeDoc(doc(over));
}

// ---------- 标签规范化 ----------

test('normalizeTag：去 #、折叠空白、截断超长；空/纯空白返回空串', () => {
  assert.equal(normalizeTag('  工作  '), '工作');
  assert.equal(normalizeTag('#工作'), '工作');
  assert.equal(normalizeTag('##双重'), '双重');
  assert.equal(normalizeTag('a  b'), 'a b');
  assert.equal(normalizeTag('a\u0000b'), 'ab');     // 控制字符（含换行）先剔除，再折叠空白
  assert.equal(normalizeTag('   '), '');
  assert.equal(normalizeTag('#'), '');
  assert.equal(normalizeTag(''), '');
  assert.equal(normalizeTag(null), '');
  assert.equal(normalizeTag(undefined), '');
  const long = 'x'.repeat(MAX_TAG_LEN + 10);
  assert.equal(normalizeTag(long).length, MAX_TAG_LEN);
});

test('parseTagInput：按空格/逗号/顿号/分号切分，去重且保序', () => {
  assert.deepEqual(parseTagInput('工作 学习'), ['工作', '学习']);
  assert.deepEqual(parseTagInput('工作,学习'), ['工作', '学习']);
  assert.deepEqual(parseTagInput('工作，学习、生活；其他'), ['工作', '学习', '生活', '其他']);
  assert.deepEqual(parseTagInput('  #工作 ,, 工作  '), ['工作']); // 大小写/重复合并
  assert.deepEqual(parseTagInput('Work work WORK'), ['Work']);
  assert.deepEqual(parseTagInput(''), []);
  assert.deepEqual(parseTagInput('  , ，、; '), []);
});

test('mergeTags / removeTag / hasTag：大小写不敏感去重、保序、已有在前', () => {
  assert.deepEqual(mergeTags(['a', 'b'], ['B', 'c']), ['a', 'b', 'c']);
  assert.deepEqual(mergeTags([], ['#x', 'x ']), ['x']);
  assert.deepEqual(mergeTags(['a'], [], ['b']), ['a', 'b']);
  assert.deepEqual(removeTag(['a', 'B', 'c'], 'b'), ['a', 'c']);
  assert.deepEqual(removeTag(['a'], '不存在'), ['a']);
  assert.deepEqual(removeTag(['#A'], '#a'), []);
  assert.equal(hasTag(['a', 'B'], 'b'), true);
  assert.equal(hasTag(['a'], 'c'), false);
  assert.equal(hasTag(['a'], ''), false);
});

test('countTags：按次数倒序、同数按名称排序；大小写合并只算一次', () => {
  const notes = [
    { tags: ['工作', '学习'] },
    { tags: ['工作', 'Work'] },
    { tags: ['work'] },
    { tags: [] },
  ];
  assert.deepEqual(countTags(notes), [
    { tag: '工作', count: 2 },
    { tag: 'Work', count: 2 },
    { tag: '学习', count: 1 },
  ]);
  assert.deepEqual(countTags([]), []);
  // 同一篇里重复标签只算一次
  assert.deepEqual(countTags([{ tags: ['x', 'X'] }]), [{ tag: 'x', count: 1 }]);
});

// ---------- 索引与置顶 ----------

test('entryFromDoc：索引条目带 tags 与 pinned', () => {
  const e = entryFromDoc(doc({ tags: ['工作'], pinned: true }));
  assert.deepEqual(e.tags, ['工作']);
  assert.equal(e.pinned, true);
  assert.equal(entryFromDoc(doc()).pinned, false);
});

test('列表排序：置顶恒在最前（时间序）', async () => {
  const files = {
    'n-a.md': contentFor({ id: 'n-a', title: 'A', updatedAt: '2025-03-01T00:00:00.000Z' }),
    'n-b.md': contentFor({ id: 'n-b', title: 'B', pinned: true, updatedAt: '2025-01-01T00:00:00.000Z' }),
    'n-c.md': contentFor({ id: 'n-c', title: 'C', updatedAt: '2025-04-01T00:00:00.000Z' }),
  };
  const core = new NoteCore(new MemoryStorage({ files, meta: { folders: '["收件箱"]' } }), { now: clock });
  await core.init();
  // listNotes 也走置顶分区：置顶的 n-b 时间最旧，但排在 n-c/n-a 之前
  assert.deepEqual(core.listNotes().map((d) => d.id), ['n-b', 'n-c', 'n-a']);
  // listNotesOrdered 与之一致（无手排时就是同一顺序）
  assert.deepEqual(core.listNotesOrdered('all').map((d) => d.id), ['n-b', 'n-c', 'n-a']);
});

test('列表排序：手排顺序在置顶分区内生效，且置顶仍在最前', async () => {
  const files = {
    'n-a.md': contentFor({ id: 'n-a', title: 'A', updatedAt: '2025-03-01T00:00:00.000Z' }),
    'n-b.md': contentFor({ id: 'n-b', title: 'B', updatedAt: '2025-02-01T00:00:00.000Z' }),
    'n-c.md': contentFor({ id: 'n-c', title: 'C', pinned: true, updatedAt: '2025-01-01T00:00:00.000Z' }),
    'n-d.md': contentFor({ id: 'n-d', title: 'D', pinned: true, updatedAt: '2025-01-05T00:00:00.000Z' }),
  };
  const core = new NoteCore(new MemoryStorage({ files, meta: { folders: '["收件箱"]' } }), { now: clock });
  await core.init();
  // 手排：普通区 a 在 b 前；置顶区 c 在 d 前（与时间序相反，证明手排生效）
  await core.setNoteOrder('all', ['n-a', 'n-b', 'n-c', 'n-d']);
  assert.deepEqual(core.listNotesOrdered('all').map((d) => d.id), ['n-c', 'n-d', 'n-a', 'n-b']);
  // 手排里把置顶项写在后面也不影响它排最前
  await core.setNoteOrder('all', ['n-a', 'n-c', 'n-b', 'n-d']);
  const ids = core.listNotesOrdered('all').map((d) => d.id);
  assert.deepEqual(ids.slice(0, 2), ['n-c', 'n-d']);
  assert.deepEqual(ids.slice(2).sort(), ['n-a', 'n-b']);
});

test('updateNote：置顶/标签变化会写入文件并可重启恢复', async () => {
  const files = { 'n-a.md': contentFor({ id: 'n-a', title: 'A' }) };
  const store = new MemoryStorage({ files, meta: { folders: '["收件箱"]' } });
  const core = new NoteCore(store, { now: clock });
  await core.init();

  await core.updateNote('n-a', { tags: ['工作', '工作', '学习'], pinned: true });
  const docAfter = core.getNote('n-a');
  assert.deepEqual(docAfter.tags, ['工作', '工作', '学习']); // 核心层不做去重，交给 UI 的 mergeTags
  assert.equal(docAfter.pinned, true);
  const raw = await store.readNoteFile('n-a.md');
  assert.match(raw, /^tags: \["工作","工作","学习"\]$/m);
  assert.match(raw, /^pinned: true$/m);

  // 重新扫描（模拟重启）后仍然保持
  const reopened = new NoteCore(store, { now: clock });
  await reopened.init();
  const doc2 = reopened.getNote('n-a');
  assert.equal(doc2.pinned, true);
  assert.deepEqual(doc2.tags, ['工作', '工作', '学习']);
  assert.equal(reopened.entries.get('n-a').pinned, true);
});

test('回收站里的笔记不参与活跃列表（置顶也一样）', async () => {
  const files = {
    'n-a.md': contentFor({ id: 'n-a', title: 'A', pinned: true }),
    'n-b.md': contentFor({ id: 'n-b', title: 'B' }),
  };
  const core = new NoteCore(new MemoryStorage({ files, meta: { folders: '["收件箱"]' } }), { now: clock });
  await core.init();
  await core.deleteNote('n-a');
  assert.deepEqual(core.listNotesOrdered('all').map((d) => d.id), ['n-b']);
  assert.deepEqual(core.listTrashNotes().map((d) => d.id), ['n-a']);
});
