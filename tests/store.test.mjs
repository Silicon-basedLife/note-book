// store 模块单元测试（v2：文件夹/笔记双实体 + 回收站 + 排序）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FOLDER_IDS, defaultSeed, createFolder, renameFolder, applyFolderOrder,
  deleteFolder, restoreFolder, purgeFolder,
  createNote, updateNote, deleteNote, deleteNotes, restoreNote, purgeNote, purgeNotes,
  moveNoteToFolder, applyNoteOrder,
  getFolder, folderNameOf, activeFolders, trashedFolders, trashedNotes,
  notesOfFolder, allActiveNotes, countActiveByFolder, binCount,
  searchNotes, plainTextOf, relativeTime, toggleTask,
} from '../demo/js/store.mjs';

const NOW = new Date('2025-06-10T09:00:00.000Z').getTime();

function getNoteById(notes, id) {
  const n = notes.find((x) => x.id === id);
  assert.ok(n, 'note not found: ' + id);
  return n;
}

test('种子数据：4 文件夹 + 8 笔记，引用合法且 order 连续', () => {
  const { folders, notes } = defaultSeed(NOW);
  assert.equal(folders.length, 4);
  assert.equal(notes.length, 8);
  const ids = new Set(folders.map((f) => f.id));
  for (const n of notes) {
    assert.ok(ids.has(n.folderId), `note ${n.id} 引用了不存在的文件夹`);
    assert.equal(n.trashed, undefined);
  }
  for (const f of folders) assert.ok(Number.isInteger(f.order));
  for (const folderId of ids) {
    const orders = notes.filter((n) => n.folderId === folderId).map((n) => n.order).sort((a, b) => a - b);
    orders.forEach((o, i) => assert.equal(o, i, `${folderId} 内 order 应连续`));
  }
  // 内容特性仍在（任务列表 + 代码块）
  assert.ok(notes.some((n) => n.body.includes('- [ ]')));
  assert.ok(notes.some((n) => n.body.includes('```')));
});

test('createFolder / renameFolder / applyFolderOrder', () => {
  const { folders } = defaultSeed(NOW);
  const { folders: f2, folder } = createFolder(folders, '新文件夹');
  assert.equal(f2.length, folders.length + 1);
  assert.equal(folder.name, '新文件夹');
  assert.ok(folder.order >= Math.max(...folders.map((f) => f.order)));
  assert.equal(folder.trashed, undefined);

  const f3 = renameFolder(f2, folder.id, ' 改名 ');
  assert.equal(getFolder(f3, folder.id).name, '改名');
  assert.equal(renameFolder(f3, folder.id, '   '), f3); // 空名忽略

  const f4 = applyFolderOrder(f3, [f3[2].id, f3[1].id, f3[0].id, f3[3].id, folder.id]);
  const ordered = [...f4].sort((a, b) => a.order - b.order).map((f) => f.id);
  assert.deepEqual(ordered, [f3[2].id, f3[1].id, f3[0].id, f3[3].id, folder.id]);
});

test('文件夹删除/还原/彻底删除（回收站语义）', () => {
  const { folders, notes } = defaultSeed(NOW);
  const wid = folders.find((f) => f.name === '工作').id;
  const workNotes = notes.filter((n) => n.folderId === wid);
  assert.ok(workNotes.length >= 2);

  const del = deleteFolder(folders, notes, wid, NOW);
  assert.equal(getFolder(del.folders, wid).trashed, true);
  for (const n of workNotes) {
    const cur = del.notes.find((x) => x.id === n.id);
    assert.equal(cur.trashed, true);
  }
  assert.equal(binCount(del.notes, del.folders), workNotes.length + 1);

  const res = restoreFolder(del.folders, del.notes, wid);
  assert.equal(getFolder(res.folders, wid).trashed, false);
  for (const n of workNotes) {
    const cur = res.notes.find((x) => x.id === n.id);
    assert.equal(cur.trashed, false);
  }

  const purged = purgeFolder(res.folders, res.notes, wid);
  assert.ok(!purged.folders.some((f) => f.id === wid));
  assert.ok(!purged.notes.some((n) => n.folderId === wid));
});

test('笔记：创建/删除/批量删除/还原/彻底删除', () => {
  const { folders, notes } = defaultSeed(NOW);
  const inbox = folders[0].id;

  const { notes: n2, note } = createNote(notes, { folderId: inbox, now: NOW });
  assert.equal(n2.length, notes.length + 1);
  assert.ok(note.order >= 0);

  const upd = updateNote(n2, note.id, { title: '改' }, NOW + 10);
  assert.equal(getNoteById(upd, note.id).title, '改');

  const t1 = deleteNote(upd, note.id, NOW);
  assert.equal(getNoteById(t1, note.id).trashed, true);
  const r1 = restoreNote(t1, note.id);
  assert.equal(getNoteById(r1, note.id).trashed, false);

  const ids = notes.slice(0, 2).map((n) => n.id);
  const t2 = deleteNotes(notes, ids, NOW);
  for (const id of ids) assert.equal(getNoteById(t2, id).trashed, true);

  const p = purgeNotes(t2, ids);
  assert.ok(!p.some((n) => ids.includes(n.id)));
  const p2 = purgeNote(p, p[0].id);
  assert.equal(p2.length, p.length - 1);
});

test('moveNoteToFolder：跨文件夹移动并置尾、回收站笔记移动即还原', () => {
  const { folders, notes } = defaultSeed(NOW);
  const inbox = folders.find((f) => f.name === '收件箱').id;
  const study = folders.find((f) => f.name === '学习').id;
  const moveTarget = notes.filter((n) => n.folderId === inbox)[0];

  const m1 = moveNoteToFolder(notes, moveTarget.id, study, NOW);
  const cur = getNoteById(m1, moveTarget.id);
  assert.equal(cur.folderId, study);
  assert.equal(cur.trashed, false);
  const maxOrder = Math.max(...m1.filter((n) => n.folderId === study && !n.trashed).map((n) => n.order));
  assert.equal(cur.order, maxOrder);

  // 回收站中的笔记拖到文件夹 = 还原
  const t = deleteNote(notes, moveTarget.id, NOW);
  const m2 = moveNoteToFolder(t, moveTarget.id, study, NOW);
  assert.equal(getNoteById(m2, moveTarget.id).trashed, false);
});

test('applyNoteOrder：仅重排指定文件夹，其他文件夹不受影响', () => {
  const { folders, notes } = defaultSeed(NOW);
  const inbox = folders.find((f) => f.name === '收件箱').id;
  const work = folders.find((f) => f.name === '工作').id;
  const inboxNotes = notes.filter((n) => n.folderId === inbox).map((n) => n.id);
  const reversed = [...inboxNotes].reverse();
  const out = applyNoteOrder(notes, inbox, reversed);
  for (const n of out) {
    if (n.folderId === inbox) {
      assert.equal(n.order, reversed.indexOf(n.id));
    }
  }
  const workBefore = notes.filter((n) => n.folderId === work).map((n) => ({ id: n.id, order: n.order }));
  for (const w of workBefore) {
    const cur = out.find((n) => n.id === w.id);
    assert.equal(cur.order, w.order);
  }
});

test('查询辅助：activeFolders / notesOfFolder / allActiveNotes / counts', () => {
  const { folders, notes } = defaultSeed(NOW);
  assert.equal(activeFolders(folders).length, folders.length);
  const inbox = folders.find((f) => f.name === '收件箱').id;
  const list = notesOfFolder(notes, inbox);
  assert.ok(list.every((n) => n.folderId === inbox && !n.trashed));
  assert.deepEqual(list.map((n) => n.order), [...list.map((n) => n.order)].sort((a, b) => a - b));

  const all = allActiveNotes(notes, folders);
  assert.equal(all.length, notes.length);
  const counts = countActiveByFolder(notes);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), notes.length);
  assert.equal(binCount(notes, folders), 0);
});

test('searchNotes：标题优先、含回收站、文件夹名标注', () => {
  const { folders, notes } = defaultSeed(NOW);
  assert.equal(searchNotes(notes, folders, '   ').length, 0);

  const r1 = searchNotes(notes, folders, 'Rust');
  assert.ok(r1.length >= 1);
  assert.equal(r1[0].where, 'title');
  assert.ok(r1[0].snippet.includes('<mark>Rust</mark>'));
  assert.equal(r1[0].folderName, '学习');

  // 回收站内容也应被搜到
  const victim = notes.find((n) => n.title === 'Vim 高频命令备忘');
  const t = deleteNote(notes, victim.id, NOW);
  const r2 = searchNotes(t, folders, 'Vim');
  assert.ok(r2.length >= 1);
  assert.equal(getNoteById(t, r2[0].note.id).trashed, true);
});

test('展示辅助：plainTextOf / relativeTime / toggleTask', () => {
  const md = '# 标题\n\n- [ ] 任务 **加粗** `code`\n\n[链接](https://a.b)';
  const t = plainTextOf(md);
  assert.ok(!t.includes('#') && !t.includes('**') && !t.includes('`') && !t.includes(']('));
  assert.ok(t.includes('标题') && t.includes('任务'));

  assert.equal(relativeTime(new Date(NOW - 30 * 1000).toISOString(), NOW), '刚刚');
  assert.equal(relativeTime(new Date(NOW - 5 * 60 * 1000).toISOString(), NOW), '5 分钟前');
  assert.equal(relativeTime(new Date(NOW - 26 * 3600 * 1000).toISOString(), NOW), '昨天');

  const body = '- [ ] 待办一\n- [x] 待办二\n正文';
  assert.equal(toggleTask(body, 0), '- [x] 待办一\n- [x] 待办二\n正文');
  assert.equal(toggleTask(body, 10), '- [ ] 待办一\n- [ ] 待办二\n正文');
  assert.equal(toggleTask(body, 99), body);
  assert.equal(folderNameOf(defaultSeed(NOW).folders, DEFAULT_FOLDER_IDS.inbox), '收件箱');
});

test('trashedFolders / trashedNotes 排序', () => {
  const { folders, notes } = defaultSeed(NOW);
  const [a, b] = [folders[0], folders[1]];
  const d1 = deleteFolder(folders, notes, a.id, NOW);
  const d2 = deleteFolder(d1.folders, d1.notes, b.id, NOW + 1000);
  const tf = trashedFolders(d2.folders);
  assert.equal(tf.length, 2);
  assert.ok(tf[0].id === a.id && tf[1].id === b.id); // 先删的在前
  assert.ok(trashedNotes(d2.notes).length >= 2);
});
