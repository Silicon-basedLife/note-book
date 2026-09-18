// todos.ts —— 待办聚合（把全库的 `- [ ]` 任务汇总成一屏）
//
// 与 markdown.ts 的预览勾选互不牵连：
// - 预览那边用 markdown-it 的 token.map + 行内 index 定位偏移（见 markdown.ts 的说明）；
// - 这里直接按行扫描 body（任务就是行级语法，扫描比走渲染器更直接，也不受嵌套列表 token 影响）。
// 两者都保证 offset 指向任务行标记本身，因此都能直接喂给 tasks.toggleTask 回写。
import { TASK_MARKER_RE } from './tasks.ts';

/** 聚合出来的一条待办 */
export interface TodoItem {
  /** 所属笔记 id */
  noteId: string;
  /** 笔记标题（空标题用“无标题笔记”占位由 UI 决定，这里保持原始 title） */
  title: string;
  folder: string;
  /** 去掉标记后的任务文本 */
  text: string;
  checked: boolean;
  /** 任务行标记在 body 中的偏移（供 toggleTask 回写） */
  offset: number;
  /** 该任务在笔记正文中的行号（从 0 计，供跳转定位） */
  line: number;
  /** 所属笔记更新时间（用于排序） */
  updatedAt: string;
}

export interface TodoNote {
  id: string;
  title: string;
  folder: string;
  updatedAt: string;
  body: string;
}

/** 单个文件里一行可能长成什么样：只需这几个字段即可聚合 */
export interface TodoSourceNote {
  id: string;
  title: string;
  folder: string;
  updatedAt: string;
  body?: string;
}

/**
 * 扫描一段正文，抽出其中的任务行。
 * 只认“以 `-`/`*`/`+` 加空格开头、紧跟 `[ ]`/`[x]`”的行——与预览端语义一致；
 * 有序列表里的 `1. [ ]` 与正文中间出现的 `[ ]` 都不算任务。
 */
export function extractTaskLines(body: string): Array<{ text: string; checked: boolean; offset: number; line: number }> {
  const out: Array<{ text: string; checked: boolean; offset: number; line: number }> = [];
  if (typeof body !== 'string' || body === '') return out;
  const lines = body.split('\n');
  let cursor = 0; // 当前行的绝对起始偏移
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = TASK_MARKER_RE.exec(line);
    if (m) {
      out.push({
        text: line.slice(m[0].length).trim(),
        checked: m[1] !== ' ',
        offset: cursor + m.index,
        line: i,
      });
    }
    cursor += line.length + 1; // +1 为换行符
  }
  return out;
}

/**
 * 汇总多篇笔记的待办。
 * - includeDone=false（默认）只返回未完成项；true 时已完成项排在未完成项之后；
 * - 排序：未完成在前 → 按笔记更新时间倒序 → 同笔记内按行号（保持正文顺序）。
 */
export function collectTodos(
  notes: ReadonlyArray<TodoSourceNote>,
  opts: { includeDone?: boolean } = {}
): TodoItem[] {
  const includeDone = opts.includeDone === true;
  const out: TodoItem[] = [];
  for (const note of notes) {
    const body = note.body ?? '';
    if (!body) continue;
    for (const t of extractTaskLines(body)) {
      if (t.checked && !includeDone) continue;
      out.push({
        noteId: note.id,
        title: note.title,
        folder: note.folder,
        text: t.text,
        checked: t.checked,
        offset: t.offset,
        line: t.line,
        updatedAt: note.updatedAt,
      });
    }
  }
  return out.sort((a, b) => {
    if (a.checked !== b.checked) return a.checked ? 1 : -1; // 未完成在前
    const byTime = b.updatedAt.localeCompare(a.updatedAt);
    if (byTime !== 0) return byTime;
    if (a.noteId !== b.noteId) return a.noteId.localeCompare(b.noteId);
    return a.line - b.line;
  });
}

/** 统计未完成 / 已完成数量（侧栏角标用；不受 includeDone 影响） */
export function countTodos(notes: ReadonlyArray<TodoSourceNote>): { open: number; done: number } {
  let open = 0;
  let done = 0;
  for (const note of notes) {
    for (const t of extractTaskLines(note.body ?? '')) {
      if (t.checked) done += 1;
      else open += 1;
    }
  }
  return { open, done };
}

/** 按关键词过滤聚合结果（标题 / 所属文件夹 / 任务文本；大小写不敏感） */
export function filterTodos(items: ReadonlyArray<TodoItem>, query: string): TodoItem[] {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [...items];
  return items.filter(
    (t) =>
      t.text.toLowerCase().includes(q) ||
      t.title.toLowerCase().includes(q) ||
      t.folder.toLowerCase().includes(q)
  );
}
