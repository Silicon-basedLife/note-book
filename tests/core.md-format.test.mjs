// core.md-format —— Markdown 格式工具栏纯逻辑（包裹/前缀/块插入/目录）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  codeBlock,
  FORMAT_BUTTONS,
  FORMAT_GROUPS,
  FORMAT_SHORTCUTS,
  formatButton,
  horizontalRule,
  lineStarts,
  link,
  table,
  toggleLinePrefix,
  toggleOrderedList,
  toggleWrap,
} from '../web/src/lib/core/md-format.ts';

/** 便捷：对整段文本应用一次操作并返回结果 */
const at = (text, start, end) => ({ text, start, end });

// ---------- toggleWrap：行内包裹 ----------

test('toggleWrap：选中文字 → 包裹并保持选中', () => {
  const r = toggleWrap(at('会议纪要', 0, 4), '**');
  assert.equal(r.text, '**会议纪要**');
  assert.equal(r.text.slice(r.start, r.end), '会议纪要');
  assert.equal(r.replaceStart, 0);
  assert.equal(r.replaceEnd, 4);
  assert.equal(r.replacement, '**会议纪要**');
});

test('toggleWrap：未选中 → 插入标记对，光标落在中间', () => {
  const r = toggleWrap(at('abc', 1, 1), '**');
  assert.equal(r.text, 'a****bc');
  assert.equal(r.start, 3);
  assert.equal(r.end, 3);
});

test('toggleWrap：外侧已有标记 → 取消（选区扩大回文字本身）', () => {
  const r = toggleWrap(at('**会议**', 2, 4), '**');
  assert.equal(r.text, '会议');
  assert.equal(r.text.slice(r.start, r.end), '会议');
});

test('toggleWrap：选中内容自带标记 → 去掉内侧标记', () => {
  const r = toggleWrap(at('前 **会议** 后', 2, 8), '**');
  assert.equal(r.text, '前 会议 后');
  assert.equal(r.text.slice(r.start, r.end), '会议');
});

test('toggleWrap：光标在标记对内部 → 取消包裹', () => {
  // 空标记对（点了按钮又点一次）
  const empty = toggleWrap(at('****', 2, 2), '**');
  assert.equal(empty.text, '');
  assert.equal(empty.start, 0);
  // 光标紧跟开标记：**|x**
  const inside = toggleWrap(at('**x**', 2, 2), '**');
  assert.equal(inside.text, 'x');
  assert.equal(inside.start, 0);
  assert.equal(inside.end, 1);
});

test('toggleWrap：斜体不会误判已被粗体包裹的文字', () => {
  // 选中 `**粗**` 里的“粗”：start-1 是 `*`，但那属于 `**`，不该算作斜体已生效
  const r = toggleWrap(at('**粗**', 2, 3), '*');
  assert.equal(r.text, '***粗***'); // 内侧再包一层斜体
  assert.equal(r.replacement, '*粗*');
});

test('toggleWrap：加粗与斜体各自独立切换', () => {
  const bold = toggleWrap(at('x', 0, 1), '**');
  assert.equal(bold.text, '**x**');
  const italicInner = toggleWrap(at(bold.text, 2, 3), '*');
  assert.equal(italicInner.text, '***x***');
  const italicOff = toggleWrap(at(italicInner.text, 3, 4), '*');
  assert.equal(italicOff.text, '**x**');
});

test('toggleWrap：删除线与高亮', () => {
  assert.equal(toggleWrap(at('旧方案', 0, 3), '~~').text, '~~旧方案~~');
  assert.equal(toggleWrap(at('重点', 0, 2), '==').text, '==重点==');
  assert.equal(toggleWrap(at('~~旧方案~~', 2, 5), '~~').text, '旧方案');
  assert.equal(toggleWrap(at('==重点==', 2, 4), '==').text, '重点');
});

test('toggleWrap：行内代码反引号', () => {
  assert.equal(toggleWrap(at('npm test', 0, 8), '`').text, '`npm test`');
  assert.equal(toggleWrap(at('`npm test`', 1, 9), '`').text, 'npm test');
});

test('toggleWrap：多行选区也能包裹', () => {
  const r = toggleWrap(at('第一行\n第二行', 0, 7), '**');
  assert.equal(r.text, '**第一行\n第二行**');
});

// ---------- 边界与自愈 ----------

test('toggleWrap：越界/负数/start>end 都不抛错且结果自洽', () => {
  assert.equal(toggleWrap(at('abc', 99, 120), '**').text, 'abc****');
  assert.equal(toggleWrap(at('abc', -5, 1), '**').text, '**a**bc');
  assert.equal(toggleWrap(at('abc', 2, 0), '**').text, '**ab**c'); // 自动交换
  assert.equal(toggleWrap({ text: '', start: 0, end: 0 }, '**').text, '****');
  assert.equal(toggleWrap({ text: undefined, start: 0, end: 0 }, '**').text, '****');
  assert.doesNotThrow(() => toggleWrap({ text: 'x', start: NaN, end: NaN }, '**'));
});

test('lineStarts：返回每行起始偏移', () => {
  assert.deepEqual(lineStarts('ab\ncd\ne'), [0, 3, 6]);
  assert.deepEqual(lineStarts(''), [0]);
});

// ---------- 行首前缀：标题 / 列表 / 引用 ----------

test('toggleLinePrefix：单行加标题，再点一次取消', () => {
  const on = toggleLinePrefix(at('标题', 0, 2), '# ', ['# ', '## ', '### ']);
  assert.equal(on.text, '# 标题');
  const off = toggleLinePrefix(at(on.text, 0, 4), '# ', ['# ', '## ', '### ']);
  assert.equal(off.text, '标题');
});

test('toggleLinePrefix：换标题级别时替换而不是叠加', () => {
  const r = toggleLinePrefix(at('## 标题', 0, 6), '# ', ['# ', '## ', '### ']);
  assert.equal(r.text, '# 标题');
});

test('toggleLinePrefix：长前缀优先剥离（H3 → H2 不留残渣）', () => {
  const r = toggleLinePrefix(at('### 标题', 0, 7), '## ', ['# ', '## ', '### ']);
  assert.equal(r.text, '## 标题');
});

test('toggleLinePrefix：多行统一加/去前缀，并选中受影响区域', () => {
  const multi = at('甲\n乙\n丙', 0, 5);
  const on = toggleLinePrefix(multi, '- ', ['- ', '* ', '+ ', '- [ ] ']);
  assert.equal(on.text, '- 甲\n- 乙\n- 丙');
  assert.equal(on.text.slice(on.start, on.end), '- 甲\n- 乙\n- 丙');
  const off = toggleLinePrefix({ text: on.text, start: on.start, end: on.end }, '- ', [
    '- ',
    '* ',
    '+ ',
    '- [ ] ',
  ]);
  assert.equal(off.text, '甲\n乙\n丙');
});

test('toggleLinePrefix：只有部分行有前缀时 → 统一补上（而不是去掉）', () => {
  const r = toggleLinePrefix(at('- 甲\n乙', 0, 5), '- ', ['- ', '* ', '+ ']);
  assert.equal(r.text, '- 甲\n- 乙');
});

test('toggleLinePrefix：待办前缀不会被无序列表前缀吃掉', () => {
  const on = toggleLinePrefix(at('任务', 0, 2), '- [ ] ', ['- [ ] ', '- ', '* ', '+ ']);
  assert.equal(on.text, '- [ ] 任务');
  // 从待办切到无序列表：应剥掉整段 `- [ ] ` 再加 `- `
  const li = toggleLinePrefix({ text: on.text, start: on.start, end: on.end }, '- ', [
    '- [ ] ',
    '- ',
    '* ',
    '+ ',
  ]);
  assert.equal(li.text, '- 任务');
});

test('toggleLinePrefix：引用加/去', () => {
  const on = toggleLinePrefix(at('引用', 0, 2), '> ', ['> ']);
  assert.equal(on.text, '> 引用');
  const off = toggleLinePrefix({ text: on.text, start: 0, end: 4 }, '> ', ['> ']);
  assert.equal(off.text, '引用');
});

test('toggleLinePrefix：只作用于选区覆盖的行，不动其它行', () => {
  const text = '保留\n改我\n保留2';
  // 选中第二行
  const start = text.indexOf('改我');
  const r = toggleLinePrefix(at(text, start, start + 2), '# ', ['# ']);
  assert.equal(r.text, '保留\n# 改我\n保留2');
});

test('toggleLinePrefix：选区终点压在下一行行首时不误改下一行', () => {
  const text = '甲\n乙';
  // 选中「甲\n」——终点在第二行行首
  const r = toggleLinePrefix(at(text, 0, 2), '- ', ['- ']);
  assert.equal(r.text, '- 甲\n乙');
});

test('toggleLinePrefix：空行也能正确加前缀', () => {
  const r = toggleLinePrefix(at('', 0, 0), '# ', ['# ']);
  assert.equal(r.text, '# ');
});

// ---------- 有序列表 ----------

test('toggleOrderedList：多行自动编号，再点取消', () => {
  const on = toggleOrderedList(at('甲\n乙\n丙', 0, 5));
  assert.equal(on.text, '1. 甲\n2. 乙\n3. 丙');
  const off = toggleOrderedList({ text: on.text, start: on.start, end: on.end });
  assert.equal(off.text, '甲\n乙\n丙');
});

test('toggleOrderedList：从无序列表切换为有序（剥离旧前缀）', () => {
  const r = toggleOrderedList(at('- 甲\n- 乙', 0, 7));
  assert.equal(r.text, '1. 甲\n2. 乙');
});

test('toggleOrderedList：已有序号的行重新编号', () => {
  const r = toggleOrderedList(at('1. 甲\n1. 乙', 0, 9));
  assert.equal(r.text, '甲\n乙'); // 两行都算“已有序”，整体取消
});

// ---------- 块插入 ----------

test('codeBlock：选中内容包进围栏并选中原文', () => {
  const r = codeBlock(at('const a = 1;', 0, 12));
  assert.equal(r.text, '```\nconst a = 1;\n```\n');
  assert.equal(r.text.slice(r.start, r.end), 'const a = 1;');
});

test('codeBlock：未选中 → 插入空围栏，光标在中间', () => {
  const r = codeBlock(at('', 0, 0));
  assert.equal(r.text, '```\n\n```\n');
  assert.equal(r.start, 4);
  assert.equal(r.end, 4);
});

test('codeBlock：行中间插入时先补换行', () => {
  const r = codeBlock(at('abc', 3, 3));
  assert.equal(r.text, 'abc\n```\n\n```\n');
});

test('link：选中文字 → 选中网址占位', () => {
  const r = link(at('官网', 0, 2));
  assert.equal(r.text, '[官网](url)');
  assert.equal(r.text.slice(r.start, r.end), 'url');
});

test('link：未选中 → 选中“文字”占位', () => {
  const r = link(at('', 0, 0));
  assert.equal(r.text, '[文字](url)');
  assert.equal(r.text.slice(r.start, r.end), '文字');
});

test('table：插入空表格并把光标放在第一个表头单元格', () => {
  const r = table(at('', 0, 0));
  assert.equal(r.text, '| 列1 | 列2 |\n| --- | --- |\n|  |  |\n');
  assert.equal(r.text.slice(r.start, r.end), '列1');
  assert.ok(r.text.includes('| --- | --- |'), '应含分隔行');
});

test('table：行中间插入时先补换行', () => {
  const r = table(at('说明', 2, 2));
  assert.equal(r.text.startsWith('说明\n| 列1'), true);
});

test('horizontalRule：独占一行插入 ---', () => {
  assert.equal(horizontalRule(at('', 0, 0)).text, '---\n');
  assert.equal(horizontalRule(at('abc', 3, 3)).text, 'abc\n---\n');
});

// ---------- 工具栏目录 ----------

test('FORMAT_BUTTONS：id 唯一、分组合法、必做项存在', () => {
  const ids = FORMAT_BUTTONS.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, 'id 不能重复');
  for (const b of FORMAT_BUTTONS) {
    assert.ok(FORMAT_GROUPS.includes(b.group), `${b.id} 分组非法`);
    assert.ok(b.label && b.title, `${b.id} 缺少 label/title`);
  }
  // 已商定的必做清单
  for (const id of [
    'bold',
    'italic',
    'strike',
    'highlight',
    'h1',
    'h2',
    'h3',
    'bullet',
    'ordered',
    'todo',
    'quote',
    'code-block',
    'link',
    'table',
  ]) {
    assert.ok(ids.includes(id), `缺少必做按钮 ${id}`);
  }
  // 折叠区
  assert.deepEqual(
    FORMAT_BUTTONS.filter((b) => b.more).map((b) => b.id),
    ['inline-code', 'hr'],
  );
});

test('FORMAT_BUTTONS：每个按钮的 apply 都能真正改动文本（空文档 + 无选区）', () => {
  for (const b of FORMAT_BUTTONS) {
    const r = b.apply({ text: '', start: 0, end: 0 });
    assert.notEqual(r.text, '', `${b.id} 在空文档下没有任何效果`);
    assert.equal(typeof r.start, 'number');
    assert.equal(typeof r.end, 'number');
    assert.ok(r.start <= r.text.length && r.end <= r.text.length, `${b.id} 选区越界`);
  }
});

test('formatButton：按 id 取定义；未知 id 返回 undefined', () => {
  assert.equal(formatButton('bold')?.label, 'B');
  assert.equal(formatButton('nope'), undefined);
});

test('FORMAT_SHORTCUTS：只给加粗/斜体默认键位，且不占用 Ctrl+K/S/,', () => {
  assert.deepEqual(FORMAT_SHORTCUTS.bold, { key: 'b', ctrl: true });
  assert.deepEqual(FORMAT_SHORTCUTS.italic, { key: 'i', ctrl: true });
  const reserved = new Set(['k', 's', ',']);
  for (const sc of Object.values(FORMAT_SHORTCUTS)) {
    assert.equal(reserved.has(sc.key), false, `${sc.key} 与已有快捷键冲突`);
  }
});

test('apply 与“替换区间”自洽：text 等于原文按 replace 区间替换后的结果', () => {
  const cases = [
    [at('会议纪要', 0, 4), (s) => toggleWrap(s, '**')],
    [at('# 标题', 0, 4), (s) => toggleLinePrefix(s, '## ', ['# ', '## ', '### '])],
    [at('甲\n乙', 0, 3), toggleOrderedList],
    [at('code', 0, 4), codeBlock],
    [at('官网', 0, 2), link],
    [at('', 0, 0), table],
    [at('', 0, 0), horizontalRule],
  ];
  for (const [state, fn] of cases) {
    const r = fn(state);
    const manual =
      state.text.slice(0, r.replaceStart) + r.replacement + state.text.slice(r.replaceEnd);
    assert.equal(r.text, manual, 'text 与 replace 区间不一致');
    assert.ok(r.start >= 0 && r.end <= r.text.length, '选区越界');
  }
});
