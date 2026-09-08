// core.order —— 文件夹排序与笔记手排持久化
import test from 'node:test';
import assert from 'node:assert/strict';
import { NoteCore } from '../web/src/lib/core/store.ts';
import { MemoryStorage } from '../web/src/lib/core/storage/memory.ts';
import { serializeDoc } from '../web/src/lib/core/frontmatter.ts';

let t = Date.parse('2025-01-03T00:00:00.000Z');
const clock = () => (t += 1000);

function mkNote(id, folder, updatedAt) {
  return serializeDoc({
    id, folder, title: id, tags: [], pinned: false,
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt, body: id, extra: [],
  });
}

function mk(files = {}) {
  return new MemoryStorage({ files, meta: { folders: '["收件箱","工作","学习"]' } });
}

test('文件夹拖拽排序：持久化、校验、重启恢复', async () => {
  const mem = mk();
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  assert.equal((await core.reorderFolders(['学习', '收件箱', '工作'])).ok, true);
  assert.deepEqual(core.listFolders(), ['学习', '收件箱', '工作']);
  assert.equal((await core.reorderFolders(['收件箱'])).ok, false); // 长度不符
  assert.equal((await core.reorderFolders(['收件箱', '工作', '不存在'])).ok, false);
  const core2 = new NoteCore(mem, { now: clock });
  await core2.init();
  assert.deepEqual(core2.listFolders(), ['学习', '收件箱', '工作']);
});

test('笔记手排：优先手排、新增追加末尾、清空回退时间序、重启恢复', async () => {
  const mem = mk({
    'n-a.md': mkNote('n-a', '工作', '2025-01-01T00:00:00.000Z'),
    'n-b.md': mkNote('n-b', '工作', '2025-02-01T00:00:00.000Z'),
    'n-c.md': mkNote('n-c', '工作', '2025-03-01T00:00:00.000Z'),
  });
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  // 默认时间序：c 最新在前
  assert.deepEqual(core.listNotesOrdered('工作').map((n) => n.id), ['n-c', 'n-b', 'n-a']);
  await core.setNoteOrder('工作', ['n-a', 'n-b', 'n-c']);
  assert.deepEqual(core.listNotesOrdered('工作').map((n) => n.id), ['n-a', 'n-b', 'n-c']);
  // 新增笔记追加到手排末尾
  const nd = await core.createNote({ folder: '工作', title: 'd', body: '' });
  assert.deepEqual(core.listNotesOrdered('工作').map((n) => n.id), ['n-a', 'n-b', 'n-c', nd.id]);
  // 重启后仍按手排
  const core2 = new NoteCore(mem, { now: clock });
  await core2.init();
  assert.deepEqual(core2.listNotesOrdered('工作').map((n) => n.id), ['n-a', 'n-b', 'n-c', nd.id]);
  // 清空 → 回到时间序（种子 c=3月、b=2月 早于时钟；新建 d 在 a(1月) 之前）
  await core2.setNoteOrder('工作', null);
  assert.deepEqual(core2.listNotesOrdered('工作').map((n) => n.id), ['n-c', 'n-b', nd.id, 'n-a']);
});

test('"全部" 作用域手排与跨文件夹移动的排序联动', async () => {
  const mem = mk({
    'n-a.md': mkNote('n-a', '工作', '2025-01-01T00:00:00.000Z'),
    'n-b.md': mkNote('n-b', '工作', '2025-02-01T00:00:00.000Z'),
    'n-c.md': mkNote('n-c', '学习', '2025-03-01T00:00:00.000Z'),
  });
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  await core.setNoteOrder('all', ['n-c', 'n-a', 'n-b']);
  assert.deepEqual(core.listNotesOrdered('all').map((n) => n.id), ['n-c', 'n-a', 'n-b']);
  // 手排后把 b 移到学习：all 作用域成员不变（顺序保留）；学习作用域将 b 追加末尾
  await core.setNoteOrder('学习', ['n-c']);
  await core.updateNote('n-b', { folder: '学习' });
  assert.deepEqual(core.listNotesOrdered('all').map((n) => n.id), ['n-c', 'n-a', 'n-b']);
  assert.deepEqual(core.listNotesOrdered('学习').map((n) => n.id), ['n-c', 'n-b']);
  // 手排列表忽略已进回收站/不属于本文件夹的残留 id
  await core.deleteNote('n-a');
  assert.deepEqual(core.listNotesOrdered('all').map((n) => n.id), ['n-c', 'n-b']);
});

test('文件夹重命名迁移手排作用域', async () => {
  const mem = mk({
    'n-a.md': mkNote('n-a', '工作', '2025-01-01T00:00:00.000Z'),
    'n-b.md': mkNote('n-b', '工作', '2025-02-01T00:00:00.000Z'),
  });
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  await core.setNoteOrder('工作', ['n-a', 'n-b']); // 与时间序相反，用于验证迁移
  await core.renameFolder('工作', '研发');
  assert.deepEqual(core.listNotesOrdered('研发').map((n) => n.id), ['n-a', 'n-b']);
  const core2 = new NoteCore(mem, { now: clock });
  await core2.init();
  assert.deepEqual(core2.listNotesOrdered('研发').map((n) => n.id), ['n-a', 'n-b']);
});
