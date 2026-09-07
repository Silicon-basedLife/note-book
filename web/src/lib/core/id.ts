// id.ts —— 稳定笔记 ID 生成
// 与 docs/TECH_DESIGN.md §3 示例一致：形如 n-xxxxxxxx。

/** 生成形如 n-xxxxxxxx 的稳定 ID（时间戳 base36 + 随机后缀） */
export function uid(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `n-${ts}${rand}`;
}

/** 判断字符串是否为合法笔记 ID（用于文件名校验等） */
export function isNoteId(value: string): boolean {
  return /^n-[a-z0-9]+$/i.test(value);
}
