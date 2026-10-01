// md-format.ts —— Markdown 格式工具栏的纯逻辑
//
// 设计：所有格式操作都表达为「替换 [replaceStart, replaceEnd) 这段文本为 replacement，
// 随后把选区设为 [start, end)」。这样 UI 层既可以直接改值，也可以把这次编辑交给
// textarea 的原生插入通道（从而进入浏览器原生撤销栈），两种落地方式共用同一份计算。
//
// 本文件不碰 DOM、不碰状态，全部可在 node:test 里断言。
// 注意：与 core/format.ts（relativeTime 等展示辅助）是两个不同文件。
import type { Shortcut } from './actions.ts';

export interface EditState {
  text: string;
  /** 选区起点（含） */
  start: number;
  /** 选区终点（不含）；与 start 相等表示光标 */
  end: number;
}

export interface FormatResult {
  /** 应用后的完整文本 */
  text: string;
  /** 应用后应设置的选区 */
  start: number;
  end: number;
  /** 需要被替换的原文区间 */
  replaceStart: number;
  replaceEnd: number;
  /** 替换进去的内容 */
  replacement: string;
}

/** 把任意输入夹到合法区间，并允许 start > end 的自愈 */
function clampRange(state: EditState): { text: string; start: number; end: number } {
  const text = typeof state?.text === 'string' ? state.text : '';
  const max = text.length;
  let a = Number.isFinite(state?.start) ? Math.trunc(state.start) : 0;
  let b = Number.isFinite(state?.end) ? Math.trunc(state.end) : a;
  a = Math.min(Math.max(0, a), max);
  b = Math.min(Math.max(0, b), max);
  if (a > b) [a, b] = [b, a];
  return { text, start: a, end: b };
}

function build(
  text: string,
  replaceStart: number,
  replaceEnd: number,
  replacement: string,
  selStart: number,
  selEnd: number,
): FormatResult {
  return {
    text: text.slice(0, replaceStart) + replacement + text.slice(replaceEnd),
    start: selStart,
    end: selEnd,
    replaceStart,
    replaceEnd,
    replacement,
  };
}

/** 某字符在 pos 之前连续出现的次数（用于区分 `*斜体*` 与 `**粗体**`） */
function runBefore(text: string, pos: number, ch: string): number {
  let n = 0;
  while (pos - 1 - n >= 0 && text[pos - 1 - n] === ch) n += 1;
  return n;
}

/** 某字符在 pos 之后连续出现的次数 */
function runAfter(text: string, pos: number, ch: string): number {
  let n = 0;
  while (pos + n < text.length && text[pos + n] === ch) n += 1;
  return n;
}

/**
 * 同字符标记是否在该位置“已生效”。Markdown 里标记长度即层数：
 * `*x*` 是斜体、`**x**` 是粗体、`***x***` 是粗体+斜体 —— 连续出现的字符数直接编码了格式，
 * 不是“同样标记叠若干层”。因此：
 * - 单字符标记（`*` 斜体、`` ` `` 行内代码）：仅当连续数为奇数时才算已生效
 *   → 这样在 `**粗**` 上点斜体会补成 `***粗***`（粗体保留），而不是把粗体误判成斜体。
 * - 多字符标记（`**` 粗体、`~~` 删除线、`==` 高亮）：连续数 ≥ 标记长度即算已生效
 *   → `***x***` 上点粗体会去掉粗体留斜体。
 */
function markerApplied(
  text: string,
  pos: number,
  ch: string,
  len: number,
  side: 'before' | 'after',
): boolean {
  const run = side === 'before' ? runBefore(text, pos, ch) : runAfter(text, pos, ch);
  if (run < len) return false;
  return len === 1 ? run % 2 === 1 : true;
}

/**
 * 行内包裹（加粗 / 斜体 / 删除线 / 高亮 / 行内代码）：可切换。
 * - 选中文字：包裹；若已包裹则取消（含“选中内容自带标记”的情况）
 * - 无选中：插入一对标记并把光标放中间；若光标正处在标记对内部则取消
 *
 * 同字符标记（如 `*` 与 `**`）用“连续出现次数”判定，避免把 `**粗体**` 误判成斜体已生效。
 */
export function toggleWrap(state: EditState, marker: string): FormatResult {
  const { text, start, end } = clampRange(state);
  const len = marker.length;
  const ch = marker[0] ?? '';
  const sameChar = len > 0 && marker.split('').every((c) => c === ch);

  const okBefore =
    start >= len &&
    text.slice(start - len, start) === marker &&
    (!sameChar || markerApplied(text, start, ch, len, 'before'));
  const okAfter =
    end + len <= text.length &&
    text.slice(end, end + len) === marker &&
    (!sameChar || markerApplied(text, end, ch, len, 'after'));
  const wrappedOuter = okBefore && okAfter;

  if (start !== end) {
    // 1) 选中内容外侧就是标记 → 去掉外侧标记
    if (wrappedOuter) {
      const replacement = text.slice(start, end);
      return build(text, start - len, end + len, replacement, start - len, end - len);
    }
    const sel = text.slice(start, end);
    // 2) 选中内容自带标记（例如用户把 `**粗体**` 整段选上）→ 去掉内侧标记
    if (sel.length >= len * 2 && sel.startsWith(marker) && sel.endsWith(marker)) {
      const inner = sel.slice(len, sel.length - len);
      return build(text, start, end, inner, start, start + inner.length);
    }
    // 3) 包裹
    return build(text, start, end, marker + sel + marker, start + len, end + len);
  }

  // 无选中：光标正处在标记对内部（含“刚插入的空标记对”）→ 取消
  if (wrappedOuter) {
    return build(text, start - len, end + len, '', start - len, start - len);
  }
  // 无选中：光标紧跟开标记、右侧还有配对的闭标记（如 `**|x**`）→ 取消这一对
  if (okBefore) {
    const closeAt = text.indexOf(marker, end);
    if (closeAt >= 0 && (!sameChar || markerApplied(text, closeAt, ch, len, 'after'))) {
      const between = text.slice(start, closeAt);
      return build(
        text,
        start - len,
        closeAt + len,
        between,
        start - len,
        start - len + between.length,
      );
    }
  }
  // 无选中：插入标记对，光标居中
  return build(text, start, end, marker + marker, start + len, start + len);
}

/** 文本中每一行的起始偏移（含第 0 行） */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

/** pos 落在第几行（0 起） */
function lineIndexAt(starts: ReadonlyArray<number>, pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((starts[mid] ?? 0) <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 选区覆盖的行区间与每行文本（含行尾判定） */
function selectedLines(state: EditState): {
  text: string;
  lines: string[];
  replaceStart: number;
  replaceEnd: number;
} {
  const { text, start, end } = clampRange(state);
  const starts = lineStarts(text);
  const firstLine = lineIndexAt(starts, start);
  // 选区终点正好压在行首时，不该把这一行算进来
  const endProbe = end > start && starts.includes(end) ? end - 1 : end;
  const lastLine = Math.max(firstLine, lineIndexAt(starts, endProbe));

  const lines: string[] = [];
  for (let i = firstLine; i <= lastLine; i += 1) {
    const from = starts[i] ?? 0;
    const to = i + 1 < starts.length ? (starts[i + 1] ?? text.length) - 1 : text.length;
    lines.push(text.slice(from, to));
  }
  return {
    text,
    lines,
    replaceStart: starts[firstLine] ?? 0,
    replaceEnd:
      lastLine + 1 < starts.length ? (starts[lastLine + 1] ?? text.length) - 1 : text.length,
  };
}

/**
 * 行首前缀切换（标题 / 无序列表 / 待办 / 引用）：作用于选区覆盖的所有行。
 * - 若所有行都已有该前缀 → 全部去掉
 * - 否则 → 先剥掉 competing 里的互斥前缀（如 H1/H2/H3 互斥），再统一加上
 */
export function toggleLinePrefix(
  state: EditState,
  prefix: string,
  competing: readonly string[] = [],
): FormatResult {
  const { text, lines, replaceStart, replaceEnd } = selectedLines(state);
  // 互斥前缀按长度倒序剥离，避免 `- [ ] ` 被 `- ` 先吃掉一半
  const stripOrder = [...new Set([prefix, ...competing])].sort((a, b) => b.length - a.length);
  /** 该行“实际带的是哪个前缀”——取最长匹配，这样 `- [ ] x` 归待办、不归无序列表 */
  const matchedPrefix = (line: string): string | null => {
    for (const p of stripOrder) {
      if (line.startsWith(p)) return p;
    }
    return null;
  };
  const allHave = lines.length > 0 && lines.every((l) => matchedPrefix(l) === prefix);
  const next = lines.map((line) => {
    let body = line;
    for (const p of stripOrder) {
      if (body.startsWith(p)) {
        body = body.slice(p.length);
        break;
      }
    }
    return allHave ? body : prefix + body;
  });

  const replacement = next.join('\n');
  return build(
    text,
    replaceStart,
    replaceEnd,
    replacement,
    replaceStart,
    replaceStart + replacement.length,
  );
}

const LIST_PREFIXES = ['- [ ] ', '- [x] ', '- [X] ', '- ', '* ', '+ '];

/** 有序列表：逐行编号（1. 2. 3. …）；已是有序列表则整体取消 */
export function toggleOrderedList(state: EditState): FormatResult {
  const { text, lines, replaceStart, replaceEnd } = selectedLines(state);
  const allOrdered = lines.length > 0 && lines.every((l) => /^\d+\.\s/.test(l));
  const next = lines.map((line, idx) => {
    let body = line;
    for (const p of LIST_PREFIXES) {
      if (body.startsWith(p)) {
        body = body.slice(p.length);
        break;
      }
    }
    if (/^\d+\.\s/.test(body)) body = body.replace(/^\d+\.\s/, '');
    return allOrdered ? body : `${idx + 1}. ${body}`;
  });

  const replacement = next.join('\n');
  return build(
    text,
    replaceStart,
    replaceEnd,
    replacement,
    replaceStart,
    replaceStart + replacement.length,
  );
}

/** 在某行中间插入块级内容时先补一个换行 */
function leadingBreak(text: string, pos: number): string {
  return pos > 0 && text[pos - 1] !== '\n' ? '\n' : '';
}

/** 代码块：选中内容包进围栏；未选中则插入空围栏并把光标放在中间 */
export function codeBlock(state: EditState): FormatResult {
  const { text, start, end } = clampRange(state);
  const fence = '```';
  const lead = leadingBreak(text, start);
  const sel = text.slice(start, end);
  if (start !== end) {
    const replacement = `${lead}${fence}\n${sel}\n${fence}\n`;
    const innerFrom = start + lead.length + fence.length + 1;
    return build(text, start, end, replacement, innerFrom, innerFrom + sel.length);
  }
  const replacement = `${lead}${fence}\n\n${fence}\n`;
  const caret = start + lead.length + fence.length + 1;
  return build(text, start, end, replacement, caret, caret);
}

/** 链接：选中文字 → `[文字](网址)` 并选中网址占位；未选中 → 选中“文字”占位 */
export function link(state: EditState): FormatResult {
  const { text, start, end } = clampRange(state);
  const sel = text.slice(start, end);
  if (sel) {
    const replacement = `[${sel}](url)`;
    const urlFrom = start + 1 + sel.length + 2;
    return build(text, start, end, replacement, urlFrom, urlFrom + 3);
  }
  const replacement = '[文字](url)';
  return build(text, start, end, replacement, start + 1, start + 3);
}

/** 表格：插入表头 + 分隔行 + 一个空行，光标落在第一个表头单元格 */
export function table(state: EditState): FormatResult {
  const { text, start, end } = clampRange(state);
  const lead = leadingBreak(text, start);
  const template = '| 列1 | 列2 |\n| --- | --- |\n|  |  |\n';
  const replacement = `${lead}${template}`;
  const caretFrom = start + lead.length + 2;
  return build(text, start, end, replacement, caretFrom, caretFrom + 2);
}

/** 分隔线：独占一行插入 --- */
export function horizontalRule(state: EditState): FormatResult {
  const { text, start, end } = clampRange(state);
  const lead = leadingBreak(text, start);
  const replacement = `${lead}---\n`;
  const caret = start + replacement.length;
  return build(text, start, end, replacement, caret, caret);
}

// ---------- 工具栏目录（UI 与快捷键共用同一份定义） ----------

export type FormatActionId =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'highlight'
  | 'inline-code'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'ordered'
  | 'todo'
  | 'quote'
  | 'code-block'
  | 'hr'
  | 'link'
  | 'table';

export interface FormatButton {
  id: FormatActionId;
  /** 按钮上显示的字形 */
  label: string;
  /** 悬停提示（写清“效果 + 语法”） */
  title: string;
  /** 分组名，同组之间用细竖线分隔 */
  group: 'inline' | 'heading' | 'block' | 'insert';
  /** true 表示收进「⋯ 更多」折叠区 */
  more?: boolean;
  /** 应用的纯逻辑动作 */
  apply: (state: EditState) => FormatResult;
}

const HEADING_PREFIXES = ['# ', '## ', '### ', '#### ', '##### ', '###### '];

export const FORMAT_BUTTONS: readonly FormatButton[] = [
  {
    id: 'bold',
    label: 'B',
    title: '加粗（**粗体**）',
    group: 'inline',
    apply: (s) => toggleWrap(s, '**'),
  },
  {
    id: 'italic',
    label: 'I',
    title: '斜体（*斜体*）',
    group: 'inline',
    apply: (s) => toggleWrap(s, '*'),
  },
  {
    id: 'strike',
    label: 'S',
    title: '删除线（~~文字~~）',
    group: 'inline',
    apply: (s) => toggleWrap(s, '~~'),
  },
  {
    id: 'highlight',
    label: '高亮',
    title: '高亮标记（==文字==）',
    group: 'inline',
    apply: (s) => toggleWrap(s, '=='),
  },
  {
    id: 'inline-code',
    label: '`x`',
    title: '行内代码（`代码`）',
    group: 'inline',
    more: true,
    apply: (s) => toggleWrap(s, '`'),
  },

  {
    id: 'h1',
    label: 'H1',
    title: '一级标题（# ）',
    group: 'heading',
    apply: (s) => toggleLinePrefix(s, '# ', HEADING_PREFIXES),
  },
  {
    id: 'h2',
    label: 'H2',
    title: '二级标题（## ）',
    group: 'heading',
    apply: (s) => toggleLinePrefix(s, '## ', HEADING_PREFIXES),
  },
  {
    id: 'h3',
    label: 'H3',
    title: '三级标题（### ）',
    group: 'heading',
    apply: (s) => toggleLinePrefix(s, '### ', HEADING_PREFIXES),
  },

  {
    id: 'bullet',
    label: '•',
    title: '无序列表（- ）',
    group: 'block',
    apply: (s) => toggleLinePrefix(s, '- ', LIST_PREFIXES),
  },
  {
    id: 'ordered',
    label: '1.',
    title: '有序列表（1. 2. 3.）',
    group: 'block',
    apply: toggleOrderedList,
  },
  {
    id: 'todo',
    label: '☑',
    title: '待办任务（- [ ] ）',
    group: 'block',
    apply: (s) => toggleLinePrefix(s, '- [ ] ', LIST_PREFIXES),
  },
  {
    id: 'quote',
    label: '❝',
    title: '引用（> ）',
    group: 'block',
    apply: (s) => toggleLinePrefix(s, '> '),
  },
  { id: 'code-block', label: '</>', title: '代码块（``` 围栏）', group: 'block', apply: codeBlock },
  {
    id: 'hr',
    label: '―',
    title: '分隔线（---）',
    group: 'block',
    more: true,
    apply: horizontalRule,
  },

  { id: 'link', label: '🔗', title: '链接（[文字](网址)）', group: 'insert', apply: link },
  { id: 'table', label: '▦', title: '表格（插入空表格）', group: 'insert', apply: table },
];

/** 分组显示顺序（渲染工具栏时用） */
export const FORMAT_GROUPS: ReadonlyArray<FormatButton['group']> = [
  'inline',
  'heading',
  'block',
  'insert',
];

/** 供 UI 与设置页共用：格式动作的默认快捷键（避开已占用的 Ctrl+K / Ctrl+S / Ctrl+,） */
export const FORMAT_SHORTCUTS: Partial<Record<FormatActionId, Shortcut>> = {
  bold: { key: 'b', ctrl: true },
  italic: { key: 'i', ctrl: true },
};

/** 按 id 找按钮定义 */
export function formatButton(id: FormatActionId): FormatButton | undefined {
  return FORMAT_BUTTONS.find((b) => b.id === id);
}
