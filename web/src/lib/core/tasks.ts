// tasks.ts —— 待办任务文本工具（勾选/取消勾选）
// 语义与 demo/js/store.mjs#toggleTask 一致：offset 指向任务行 "-" 的起始偏移，
// 勾选位固定在该行第 offset+3 个字符（"- [ ]" 中括号内的空格/x）。
// 预览端 checkbox 点击 → 用此函数回写源文（对应 ROADMAP「编辑与预览中可勾选」）。

/** 判断 body 中 offset 处是否为可勾选任务行（"- " 或 "* " 前缀 + 括号标记） */
export function isTaskMarkerAt(body: string, offset: number): boolean {
  return /^[-*] \[[ xX]\]/.test(body.slice(offset, offset + 6));
}

/** 切换 offset 处任务的勾选状态；非任务位置/越界时原样返回 */
export function toggleTask(body: string, offset: number): string {
  if (typeof body !== 'string' || !Number.isInteger(offset)) return body;
  const head = body.slice(offset, offset + 6);
  if (!/^[-*] \[[ xX]\]/.test(head)) return body;
  const ch = offset + 3;
  const cur = body[ch];
  if (cur !== ' ' && cur !== 'x' && cur !== 'X') return body;
  const next = cur === ' ' ? 'x' : ' ';
  return body.slice(0, ch) + next + body.slice(ch + 1);
}

export interface TaskMarker {
  /** 该任务行 "-" 在 body 中的字符偏移（供 toggleTask 回写） */
  offset: number;
  checked: boolean;
}
