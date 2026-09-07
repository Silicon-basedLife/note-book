// store 模块单元测试
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLDERS, defaultSeed, createNote, updateNote, deleteNote, toggleTask,
  sortByUpdated, folderCounts, searchNotes, plainTextOf, relativeTime,
} from '../demo/js/store.mjs';

const NOW = new Date('2025-06-10T09:00:00.000Z').getTime();

test('种子数据：8 条且文件夹分布合理', () => {
  const notes = defaultSeed(NOW);
  assert.equal(notes.length, 8);
  const counts = folderCounts(notes);
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 8);
  FOLDERS.forEach((f) => assert.ok(f in counts));
  // 每篇正文均非空，且含 Markdown 特性
  assert.ok(notes.some((n) => n.body.includes('- [ ]')));
  assert.ok(notes.some((n) => n.body.includes('```')));
});

test('createNote：默认落入收件箱并置顶', () => {
  const seed = defaultSeed(NOW);
  const { notes, note } = createNote(seed, { now: NOW });
  assert.equal(notes.length, seed.length + 1);
  assert.equal(note.folder, '收件箱');
  assert.equal(note.title, '无标题笔记');
  assert.equal(notes[0].id, note.id);
});

test('updateNote：仅更新目标并刷新 updatedAt', () => {
  const seed = defaultSeed(NOW);
  const out = updateNote(seed, seed[0].id, { title: '新标题' }, NOW + 1000);
  assert.equal(out[0].title, '新标题');
  assert.ok(out[0].updatedAt > seed[0].updatedAt);
  assert.equal(out[1], seed[1]); // 其他笔记引用不变
});

test('deleteNote：移除指定笔记', () => {
  const seed = defaultSeed(NOW);
  const out = deleteNote(seed, seed[0].id);
  assert.equal(out.length, seed.length - 1);
  assert.ok(!out.some((n) => n.id === seed[0].id));
});

test('toggleTask：勾选与取消、越界保护', () => {
  const body = '- [ ] 待办一\n- [x] 待办二\n正文';
  const t1 = toggleTask(body, 0);
  assert.equal(t1, '- [x] 待办一\n- [x] 待办二\n正文');
  const t2 = toggleTask(t1, 0);
  assert.equal(t2, body);
  const t3 = toggleTask(body, 10); // 第二行 '-' 偏移
  assert.equal(t3, '- [ ] 待办一\n- [ ] 待办二\n正文');
  assert.equal(toggleTask(body, 99), body); // 越界不动
  assert.equal(toggleTask(body, 15), body); // 非任务位置不动
});

test('sortByUpdated：按更新时间倒序', () => {
  const seed = defaultSeed(NOW);
  const sorted = sortByUpdated(seed);
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i - 1].updatedAt >= sorted[i].updatedAt);
  }
});

test('searchNotes：标题命中优先于正文，支持高亮片段', () => {
  const seed = defaultSeed(NOW);
  const empty = searchNotes(seed, '   ');
  assert.equal(empty, null);

  const r1 = searchNotes(seed, 'Rust');
  assert.ok(r1.length >= 1);
  assert.equal(r1[0].where, 'title');
  assert.ok(r1[0].snippet.includes('<mark>Rust</mark>'));

  const r2 = searchNotes(seed, '联调');
  assert.ok(r2.length >= 1);
  assert.ok(r2.every((r) => r.snippet.includes('<mark>联调</mark>')));

  const r3 = searchNotes(seed, '不存在的关键词xyz');
  assert.equal(r3.length, 0);
});

test('plainTextOf：去除 Markdown 符号', () => {
  const md = '# 标题\n\n- [ ] 任务 **加粗** `code`\n\n[链接](https://a.b)';
  const t = plainTextOf(md);
  assert.ok(!t.includes('#'));
  assert.ok(!t.includes('**'));
  assert.ok(!t.includes('`'));
  assert.ok(!t.includes(']('));
  assert.ok(t.includes('标题'));
  assert.ok(t.includes('任务'));
});

test('relativeTime：常用粒度', () => {
  assert.equal(relativeTime(new Date(NOW - 30 * 1000).toISOString(), NOW), '刚刚');
  assert.equal(relativeTime(new Date(NOW - 5 * 60 * 1000).toISOString(), NOW), '5 分钟前');
  assert.equal(relativeTime(new Date(NOW - 3 * 3600 * 1000).toISOString(), NOW), '3 小时前');
  assert.equal(relativeTime(new Date(NOW - 26 * 3600 * 1000).toISOString(), NOW), '昨天');
  assert.equal(relativeTime(new Date(NOW - 3 * 86400 * 1000).toISOString(), NOW), '3 天前');
});
