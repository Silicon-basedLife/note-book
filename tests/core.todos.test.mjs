// core.todos —— 待办聚合：行扫描、汇总排序、计数、过滤、勾选回写一致性
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectTodos,
  countTodos,
  extractTaskLines,
  filterTodos,
} from '../web/src/lib/core/todos.ts';
import { isTaskMarkerAt, toggleTask } from '../web/src/lib/core/tasks.ts';

const note = (over = {}) => ({
  id: 'n-1',
  title: '笔记一',
  folder: '收件箱',
  updatedAt: '2025-01-01T00:00:00.000Z',
  body: '',
  ...over,
});

// ---------- 行扫描 ----------

test('extractTaskLines：识别 - / * / + 与 [ ]/[x]/[X]，文本去掉标记', () => {
  const body = ['- [ ] 甲', '* [x] 乙', '+ [X] 丙'].join('\n');
  assert.deepEqual(extractTaskLines(body), [
    { text: '甲', checked: false, offset: 0, line: 0 },
    { text: '乙', checked: true, offset: 8, line: 1 },
    { text: '丙', checked: true, offset: 16, line: 2 },
  ]);
});

test('extractTaskLines：marker 后必须有空白，[] 内容必须是单字符空格/x/X', () => {
  assert.deepEqual(extractTaskLines('- [ ]'), []); // 缺 `]` 后的空白
  assert.deepEqual(extractTaskLines('- []任务'), []); // 括号内为空
  assert.deepEqual(extractTaskLines('- [ab] 任务'), []); // 括号内多字符
  assert.deepEqual(extractTaskLines('- 任务'), []); // 无勾选框
  assert.deepEqual(extractTaskLines('说明里的 [ ] 不算任务'), []); // 行首不是标记
  assert.deepEqual(extractTaskLines('1. [ ] 有序列表不算任务'), []); // 有序列表
});

test('extractTaskLines：前置文字/空行不影响偏移，缩进任务（嵌套）也能识别', () => {
  const body = '说明：两件小事\n\n- [ ] 第一件\n  - [x] 第二件（缩进）';
  const got = extractTaskLines(body);
  assert.equal(got.length, 2);
  assert.equal(got[0].line, 2);
  assert.equal(body.slice(got[0].offset, got[0].offset + 3), '- [');
  assert.equal(got[1].line, 3);
  assert.equal(got[1].checked, true);
  // 偏移指向标记本身，因此可直接喂给 toggleTask
  assert.equal(isTaskMarkerAt(body, got[0].offset), true);
  assert.equal(toggleTask(body, got[0].offset).includes('- [x] 第一件'), true);
});

test('extractTaskLines：任务文本保留行内 markdown 与首尾空白裁剪', () => {
  const got = extractTaskLines('- [ ]   带 **加粗** 与空格   ');
  assert.equal(got[0].text, '带 **加粗** 与空格');
});

test('extractTaskLines：空 body / 非字符串输入安全返回空数组', () => {
  assert.deepEqual(extractTaskLines(''), []);
  assert.deepEqual(extractTaskLines(undefined), []);
  assert.deepEqual(extractTaskLines(null), []);
});

test('extractTaskLines：CRLF 行尾不会把 \\r 带进任务文本', () => {
  const body = '- [ ] 甲\r\n- [x] 乙\r\n';
  const got = extractTaskLines(body);
  assert.equal(got.length, 2);
  assert.equal(got[0].text, '甲');
  assert.equal(got[1].text, '乙');
});

// ---------- 汇总与排序 ----------

test('collectTodos：默认只收未完成，跨笔记汇总并带出来源信息', () => {
  const notes = [
    note({
      id: 'n-1',
      title: '工作笔记',
      folder: '工作',
      updatedAt: '2025-02-01T00:00:00.000Z',
      body: '- [ ] 写周报\n- [x] 已完成的',
    }),
    note({
      id: 'n-2',
      title: '学习笔记',
      folder: '学习',
      updatedAt: '2025-01-01T00:00:00.000Z',
      body: '- [ ] 看文档',
    }),
  ];
  const got = collectTodos(notes);
  assert.deepEqual(
    got.map((t) => [t.noteId, t.text, t.folder]),
    [
      ['n-1', '写周报', '工作'],
      ['n-2', '看文档', '学习'],
    ],
  );
  assert.equal(got[0].checked, false);
  assert.equal(got[0].title, '工作笔记');
});

test('collectTodos：includeDone=true 时已完成排在后半段', () => {
  const notes = [
    note({ id: 'n-1', updatedAt: '2025-02-01T00:00:00.000Z', body: '- [x] 已完成\n- [ ] 未完成' }),
    note({ id: 'n-2', updatedAt: '2025-03-01T00:00:00.000Z', body: '- [x] 另一篇已完成' }),
  ];
  const got = collectTodos(notes, { includeDone: true });
  // 未完成恒在前；已完成内部仍按笔记更新时间倒序（n-2 更新 → 排前）
  assert.deepEqual(
    got.map((t) => [t.checked, t.text]),
    [
      [false, '未完成'],
      [true, '另一篇已完成'],
      [true, '已完成'],
    ],
  );
});

test('collectTodos：排序为「未完成在前 → 笔记更新时间倒序 → 同笔记按行号」', () => {
  const notes = [
    note({ id: 'n-old', updatedAt: '2025-01-01T00:00:00.000Z', body: '- [ ] 旧笔记任务' }),
    note({
      id: 'n-new',
      updatedAt: '2025-06-01T00:00:00.000Z',
      body: '- [ ] 新笔记第一行\n- [ ] 新笔记第二行',
    }),
  ];
  const got = collectTodos(notes);
  assert.deepEqual(
    got.map((t) => t.text),
    ['新笔记第一行', '新笔记第二行', '旧笔记任务'],
  );
});

test('collectTodos：没有正文（索引里 body 被省略）的笔记被跳过，不抛错', () => {
  const got = collectTodos([
    { id: 'n-1', title: 'x', folder: '收件箱', updatedAt: '2025-01-01T00:00:00.000Z' },
  ]);
  assert.deepEqual(got, []);
});

test('countTodos：分别统计未完成与已完成（角标用）', () => {
  const notes = [note({ body: '- [ ] a\n- [x] b\n- [ ] c' }), note({ id: 'n-2', body: '- [x] d' })];
  assert.deepEqual(countTodos(notes), { open: 2, done: 2 });
  assert.deepEqual(countTodos([]), { open: 0, done: 0 });
});

test('filterTodos：按任务文本 / 笔记标题 / 文件夹过滤，大小写不敏感', () => {
  const notes = [
    note({ id: 'n-1', title: 'Rust 笔记', folder: '工作', body: '- [ ] 复习 Ownership' }),
    note({ id: 'n-2', title: '生活', folder: '学习', body: '- [ ] 买牛奶' }),
  ];
  const all = collectTodos(notes);
  assert.equal(filterTodos(all, '').length, 2);
  assert.deepEqual(
    filterTodos(all, 'ownership').map((t) => t.text),
    ['复习 Ownership'],
  );
  assert.deepEqual(
    filterTodos(all, '生活').map((t) => t.text),
    ['买牛奶'],
  );
  assert.deepEqual(
    filterTodos(all, '工作').map((t) => t.text),
    ['复习 Ownership'],
  );
  assert.deepEqual(filterTodos(all, '不存在的词'), []);
});

test('聚合结果与预览回写一致：勾选后该任务在聚合里变为已完成', () => {
  const body = '- [ ] 甲\n- [ ] 乙';
  const notes = [note({ body })];
  const before = collectTodos(notes);
  assert.equal(before.length, 2);

  const toggled = toggleTask(body, before[1].offset); // 勾掉“乙”
  const after = collectTodos([note({ body: toggled })]);
  assert.deepEqual(
    after.map((t) => t.text),
    ['甲'],
  );
  assert.deepEqual(
    collectTodos([note({ body: toggled })], { includeDone: true }).map((t) => [t.text, t.checked]),
    [
      ['甲', false],
      ['乙', true],
    ],
  );
});
