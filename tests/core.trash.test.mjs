// core.trash —— 回收站：软删除/还原/彻底删除/文件夹回收/搜索范围
import test from 'node:test';
import assert from 'node:assert/strict';
import { NoteCore } from '../web/src/lib/core/store.ts';
import { MemoryStorage } from '../web/src/lib/core/storage/memory.ts';
import { serializeDoc } from '../web/src/lib/core/frontmatter.ts';
import { noteFileName } from '../web/src/lib/core/storage/port.ts';

let t = Date.parse('2025-01-03T00:00:00.000Z');
const clock = () => (t += 1000);

function doc(id, folder, title, body, over = {}) {
  return serializeDoc({
    id, folder, title, tags: [], pinned: false,
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z',
    body, extra: [], ...over,
  });
}

function mk(files = {}) {
  return new MemoryStorage({ files, meta: { folders: '["收件箱","工作"]' } });
}

test('批量删除进回收站；搜索默认不含、includeTrash 命中带标记', async () => {
  const mem = mk({
    'n-1.md': doc('n-1', '工作', '一', '唯一关键词A'),
    'n-2.md': doc('n-2', '工作', '二', '唯一关键词B'),
    'n-3.md': doc('n-3', '收件箱', '三', '唯一关键词C'),
  });
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  assert.equal(await core.deleteNotes(['n-1', 'n-2']), 2);
  assert.equal(core.countsTrash().notes, 2);
  assert.deepEqual(core.listTrashNotes().map((n) => n.id).sort(), ['n-1', 'n-2']);
  assert.equal(core.listNotes('工作').length, 0);
  // 文件仍在且带 deleted 标记（结构保留）
  assert.ok((await mem.readNoteFile('n-1.md')).includes('deleted: true'));
  // 搜索：默认不含回收站；includeTrash 含回收站命中并标记
  assert.equal(core.search('唯一关键词A').length, 0);
  const hits = core.search('唯一关键词A', null, { includeTrash: true });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].deleted, true);
  assert.equal(hits[0].noteId, 'n-1');
  // 回收站笔记不可当作活跃笔记移动
  await core.updateNote('n-1', { folder: '收件箱' });
  assert.equal(core.listTrashNotes().find((n) => n.id === 'n-1').folder, '工作');
});

test('还原：单独还原；文件夹在回收站时还原笔记会连同文件夹复活', async () => {
  const mem = mk({
    'n-a.md': doc('n-a', '项目', '方案', '内容A'),
    'n-b.md': doc('n-b', '项目', '总结', '内容B'),
  });
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  await core.deleteFolder('项目'); // 文件夹连同两条笔记进回收站
  assert.equal(core.listTrashFolders().length, 1);
  // 还原其中一条笔记 → 文件夹应一并复活（含另一条）
  assert.equal(await core.restoreNote('n-a'), true);
  assert.ok(core.listFolders().includes('项目'));
  assert.equal(core.listNotes('项目').length, 2);
  assert.equal(core.countsTrash().folders, 0);
});

test('彻底删除文件夹：物理删除其笔记并清注册；清空回收站兜底', async () => {
  const mem = mk({
    'n-a.md': doc('n-a', '项目', '方案', '内容A'),
    'n-b.md': doc('n-b', '项目', '总结', '内容B'),
  });
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  await core.deleteFolder('项目');
  assert.equal((await core.purgeFolder('项目')).ok, true);
  assert.equal(await mem.readNoteFile('n-a.md'), null);
  assert.equal(await mem.readNoteFile('n-b.md'), null);
  assert.equal(core.countsTrash().notes, 0);
  assert.equal(core.countsTrash().folders, 0);
  // 清空回收站
  await core.createNote({ folder: '工作', title: 'x', body: 'y' });
  await core.createNote({ folder: '工作', title: 'z', body: 'w' });
  await core.deleteNotes([core.listNotes('工作')[0].id, core.listNotes('工作')[1].id]);
  await core.purgeTrash();
  assert.equal(core.countsTrash().notes, 0);
});

test('启动扫描：回收站笔记可被识别且不复活其文件夹', async () => {
  const mem = mk({
    'n-x.md': doc('n-x', '已删文件夹', '旧文', 'zzz', { deleted: true, deletedAt: '2025-01-02T00:00:00.000Z' }),
    'n-y.md': doc('n-y', '收件箱', '正常', 'yyy'),
  });
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  assert.ok(!core.listFolders().includes('已删文件夹')); // 不复活
  assert.equal(core.listNotes().length, 1);
  assert.equal(core.listTrashNotes().length, 1);
  assert.equal(core.countsTrash().notes, 1);
  assert.equal(core.search('zzz', null, { includeTrash: true }).length, 1);
});

test('事件：deleted/restored/purged 广播', async () => {
  const mem = mk({ 'n-1.md': doc('n-1', '收件箱', '一', 'x') });
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  const ops = [];
  core.on((e) => { if (e.type === 'note') ops.push(e.op); });
  await core.deleteNote('n-1');
  await core.restoreNote('n-1');
  await core.deleteNote('n-1');
  await core.purgeNote('n-1');
  assert.deepEqual(ops, ['deleted', 'restored', 'deleted', 'purged']);
});
