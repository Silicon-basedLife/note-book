// tasks.ts —— 待办任务文本工具（勾选/取消勾选）
// 语义与 demo/js/store.mjs#toggleTask 一致：offset 指向任务行标记（-,*,+）的起始偏移，
// 勾选位固定在该行第 offset+3 个字符（"- [ ]" 中括号内的空格/x）。
// 预览端 checkbox 点击 → 用 toggleTask 回写源文（对应 ROADMAP「编辑与预览中可勾选」）。
// 注意：这里只管“按偏移翻转勾选态”；待办聚合视图的行扫描在 todos.ts。

/** 任务行标记：`- [ ]` / `* [x]` / `+ [X]`（标记后需有空白） */
export const TASK_MARKER_RE = /[-*+]\s+\[([ xX])\]\s/;

/** 判断 body 中 offset 处是否为可勾选任务行（"- " 或 "* "/"+ " 前缀 + 括号标记） */
export function isTaskMarkerAt(body: string, offset: number): boolean {
  return /^[-*+] \[[ xX]\]/.test(body.slice(offset, offset + 6));
}

/** 切换 offset 处任务的勾选状态；非任务位置/越界时原样返回 */
export function toggleTask(body: string, offset: number): string {
  if (typeof body !== 'string' || !Number.isInteger(offset)) return body;
  const head = body.slice(offset, offset + 6);
  if (!/^[-*+] \[[ xX]\]/.test(head)) return body;
  const ch = offset + 3;
  const cur = body[ch];
  if (cur !== ' ' && cur !== 'x' && cur !== 'X') return body;
  const next = cur === ' ' ? 'x' : ' ';
  return body.slice(0, ch) + next + body.slice(ch + 1);
}

export interface TaskMarker {
  /** 该任务行标记在 body 中的字符偏移（供 toggleTask 回写） */
  offset: number;
  checked: boolean;
}
