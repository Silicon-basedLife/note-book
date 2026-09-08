// core.store —— NoteCore（CRUD / 文件夹 / 事件 / 持久化重启恢复）
import test from 'node:test';
import assert from 'node:assert/strict';
import { NoteCore } from '../web/src/lib/core/store.ts';
import { MemoryStorage } from '../web/src/lib/core/storage/memory.ts';
import { docFromContent, serializeDoc, splitFrontmatter } from '../web/src/lib/core/frontmatter.ts';
import { noteFileName } from '../web/src/lib/core/storage/port.ts';

let t = Date.parse('2025-01-03T00:00:00.000Z');
const clock = () => (t += 1000); // 每次操作时间递增，便于断言排序

function storage(files) {
  return new MemoryStorage({ files, meta: { folders: '["收件箱","工作"]' } });
}

function seedOne(over = {}) {
  const base = {
    id: 'n-seed1',
    folder: '工作',
    title: '种子标题',
    tags: '["a"]',
    pinned: 'false',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
    ...over,
  };
  const fm = Object.entries(base).map(([k, v]) => `${k}: ${v}`).join('\n');
  const body = '# 种子标题\n正文内容 Rust';
  return `---\n${fm}\n---\n${body}`;
}

function contentWith(id, folder, title, body, updatedAt) {
  return serializeDoc({
    id, folder, title, tags: [], pinned: false,
    createdAt: '2025-01-01T00:00:00.000Z', updatedAt, body, extra: [],
  });
}

test('init：空库默认只有收件箱，计数为 0', async () => {
  const core = new NoteCore(storage(), { now: clock });
  await core.init();
  assert.deepEqual(core.listFolders(), ['收件箱', '工作']);
  assert.equal(core.listNotes().length, 0);
  assert.deepEqual(core.counts(), { 收件箱: 0, 工作: 0 });
  assert.ok(core.ready);
});

test('init：扫描已有 .md 文件并解析 frontmatter / 纯文本索引', async () => {
  const files = {
    'n-seed1.md': seedOne(),
    'n-seed2.md': contentWith('n-seed2', '学习', '另一篇', '标题\n\n正文没有关键词', '2025-02-01T00:00:00.000Z'),
    'readme.txt': '非笔记文件应被忽略',
  };
  const core = new NoteCore(storage(files), { now: clock });
  await core.init();
  assert.equal(core.listNotes().length, 2);
  // 倒序：更新时间新者在前
  const list = core.listNotes();
  assert.equal(list[0].id, 'n-seed2');
  // 标题命中优先、正文纯文本可命中
  const hits = core.search('Rust');
  assert.ok(hits && hits.length === 1 && hits[0].noteId === 'n-seed1');
  assert.ok(core.search('关键词')?.some((h) => h.noteId === 'n-seed2'));
  // 无 frontmatter 回退（文件名做 ID）
  const raw = new MemoryStorage({ files: { 'n-raw.md': '# 裸笔记' }, meta: {} });
  const c2 = new NoteCore(raw, { now: clock });
  await c2.init();
  const bare = c2.getNote('n-raw');
  assert.ok(bare && bare.folder === '收件箱' && bare.body === '# 裸笔记');
});

test('createNote：落盘为 <id>.md + frontmatter，默认收件箱，事件广播', async () => {
  const mem = storage();
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  const events = [];
  const off = core.on((e) => { if (e.type === 'note') events.push(`${e.op}:${e.note.id}`); });
  const note = await core.createNote({ title: '新笔记', body: 'hello' });
  assert.match(note.id, /^n-/);
  assert.equal(note.folder, '收件箱');
  assert.ok(note.createdAt <= note.updatedAt);
  const raw = await mem.readNoteFile(noteFileName(note.id));
  assert.ok(raw && raw.startsWith('---\nid: ' + note.id));
  const parsed = docFromContent(raw, { fallbackId: note.id, nowIso: note.createdAt });
  assert.equal(parsed.body, 'hello');
  assert.equal(core.counts()['收件箱'], 1);
  assert.deepEqual(events, ['created:' + note.id]);
  off();
});

test('updateNote：标题/正文更新索引与落盘，正文命中更新后即时生效', async () => {
  const files = { 'n-s1.md': contentWith('n-s1', '收件箱', '标题A', '正文alpha', '2025-01-01T00:00:00.000Z') };
  const mem = storage(files);
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  const before = core.getNote('n-s1');
  await core.updateNote('n-s1', { title: '标题B', body: '正文 beta关键词' });
  const after = core.getNote('n-s1');
  assert.equal(after.title, '标题B');
  assert.ok(after.updatedAt > before.updatedAt);
  assert.equal(core.search('标题A').length, 0);
  assert.ok(core.search('beta关键词')?.length === 1);
  const raw = await mem.readNoteFile('n-s1.md');
  assert.ok(raw.includes('title: 标题B'));
  assert.ok(raw.includes('正文 beta关键词'));
});

test('updateNote：仅移动文件夹不刷新 updatedAt', async () => {
  const files = { 'n-s1.md': contentWith('n-s1', '收件箱', '标题A', '正文', '2025-01-01T00:00:00.000Z') };
  const core = new NoteCore(storage(files), { now: clock });
  await core.init();
  const before = core.getNote('n-s1');
  await core.updateNote('n-s1', { folder: '工作' });
  const after = core.getNote('n-s1');
  assert.equal(after.folder, '工作');
  assert.equal(after.updatedAt, before.updatedAt);
});

test('deleteNote：移入回收站（软删除），可还原与彻底删除', async () => {
  const files = { 'n-d1.md': contentWith('n-d1', '收件箱', '待删', 'x', '2025-01-01T00:00:00.000Z') };
  const mem = storage(files);
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  const events = [];
  core.on((e) => { if (e.type === 'note') events.push(`${e.op}:${e.note.id}`); });
  assert.equal(await core.deleteNote('n-d1'), true);
  // 文件保留，frontmatter 写入 deleted: true
  const raw = await mem.readNoteFile('n-d1.md');
  assert.ok(raw.includes('deleted: true'));
  const inTrash = core.getNote('n-d1');
  assert.equal(inTrash.deleted, true);
  assert.ok(inTrash.deletedAt);
  // 活跃列表/计数/搜索默认不含回收站
  assert.equal(core.listNotes().length, 0);
  assert.equal(core.counts()['收件箱'], 0);
  assert.equal(core.search('待删').length, 0);
  assert.equal(core.countsTrash().notes, 1);
  assert.equal(core.listTrashNotes().length, 1);
  assert.deepEqual(events, ['deleted:n-d1']);
  // 已删除再删无效
  assert.equal(await core.deleteNote('n-d1'), false);
  // 还原
  assert.equal(await core.restoreNote('n-d1'), true);
  assert.equal(core.getNote('n-d1').deleted, undefined);
  assert.equal(core.listNotes().length, 1);
  assert.equal(core.countsTrash().notes, 0);
  assert.ok((await mem.readNoteFile('n-d1.md')).includes('title: 待删'));
  assert.ok(!(await mem.readNoteFile('n-d1.md')).includes('deleted: true'));
  // 再删后彻底删除
  await core.deleteNote('n-d1');
  assert.equal(await core.purgeNote('n-d1'), true);
  assert.equal(await mem.readNoteFile('n-d1.md'), null);
  assert.equal(core.getNote('n-d1'), undefined);
  assert.equal(await core.purgeNote('n-d1'), false);
});

test('toggleTask：勾选回写并落盘，无效偏移不动', async () => {
  const files = { 'n-t1.md': contentWith('n-t1', '收件箱', 't', '- [ ] 事项一\n- [ ] 事项二', '2025-01-01T00:00:00.000Z') };
  const mem = storage(files);
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  assert.equal(await core.toggleTask('n-t1', 0), true);
  assert.equal(core.getNote('n-t1').body, '- [x] 事项一\n- [ ] 事项二');
  assert.ok((await mem.readNoteFile('n-t1.md')).includes('- [x] 事项一'));
  assert.equal(await core.toggleTask('n-t1', 99), false);
});

test('文件夹：新建/重命名持久化；删除文件夹整组进回收站并可再生还原', async () => {
  const mem = storage();
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  assert.equal((await core.createFolder('读书')).ok, true);
  assert.deepEqual(core.listFolders(), ['收件箱', '工作', '读书']);
  assert.equal((await core.createFolder(' 读书 ')).ok, false); // 重名拒绝
  assert.equal((await core.createFolder('   ')).ok, false); // 空名拒绝

  const note = await core.createNote({ folder: '读书', title: '在读', body: 'x' });
  await core.renameFolder('读书', '阅读');
  assert.equal(core.getNote(note.id).folder, '阅读');
  assert.ok(core.listFolders().includes('阅读') && !core.listFolders().includes('读书'));
  // 删除文件夹 → 整组（含笔记）进回收站，保留原始结构
  await core.createNote({ folder: '阅读', title: '第二本', body: 'y' });
  await core.deleteFolder('阅读');
  assert.deepEqual(core.listFolders(), ['收件箱', '工作']);
  assert.equal(core.countsTrash().notes, 2);
  assert.equal(core.countsTrash().folders, 1);
  const tf = core.listTrashFolders();
  assert.equal(tf.length, 1);
  assert.equal(tf[0].name, '阅读');
  assert.equal(tf[0].noteCount, 2);
  // 还原文件夹 → 笔记回到活跃列表与文件夹
  assert.equal((await core.restoreFolder('阅读')).ok, true);
  assert.deepEqual(core.listFolders(), ['收件箱', '工作', '阅读']);
  assert.equal(core.listNotes('阅读').length, 2);
  assert.equal(core.countsTrash().folders, 0);
  // 默认文件夹不可删除
  assert.equal((await core.deleteFolder('收件箱')).ok, false);
  // 重启恢复
  const core2 = new NoteCore(mem, { now: clock });
  await core2.init();
  assert.deepEqual(core2.listFolders(), ['收件箱', '工作', '阅读']);
  assert.equal(core2.listNotes('阅读').length, 2);
});

test('重启恢复：新 Core 实例从同一存储读到全部笔记（验收：重启后内容仍在）', async () => {
  const mem = storage();
  const core = new NoteCore(mem, { now: clock });
  await core.init();
  const a = await core.createNote({ title: 'A', body: '内容A' });
  const b = await core.createNote({ folder: '工作', title: 'B', body: '内容B' });
  const core2 = new NoteCore(mem, { now: clock });
  await core2.init();
  assert.equal(core2.listNotes().length, 2);
  assert.equal(core2.getNote(a.id)?.body, '内容A');
  assert.equal(core2.getNote(b.id)?.folder, '工作');
  // 重启后仍能全文命中
  assert.ok(core2.search('内容B')?.some((h) => h.noteId === b.id));
});

test('事件订阅可退订；note 快照不被外部修改影响', async () => {
  const core = new NoteCore(storage(), { now: clock });
  await core.init();
  let count = 0;
  const off = core.on(() => { count += 1; });
  const note = await core.createNote({});
  const snap = core.getNote(note.id);
  snap.title = '外部篡改';
  assert.equal(core.getNote(note.id).title, '');
  off();
  await core.createNote({});
  assert.equal(count, 1);
});

test('serializeDoc/splitFrontmatter 与存储内容一致', () => {
  const s = seedOne();
  const { entries, body } = splitFrontmatter(s);
  assert.ok(entries && entries.some((e) => e.key === 'tags' && e.value === '["a"]'));
  assert.ok(body.includes('Rust'));
});
