// tags.ts —— 标签的解析与规范化（纯函数，UI 与核心共用）
//
// 设计约定：
// - 标签存进 frontmatter 的 tags（JSON 数组），单个标签不含空白与 '#'，长度 1..MAX_TAG_LEN；
// - 用户在一个输入框里输入时允许用空格 / 逗号 / 顿号分隔一次录入多个标签；
// - 去重按大小写不敏感（保留首次出现的大小写），保证 "Work" 与 "work" 不会同时存在。

/** 单个标签最大长度（超出截断） */
export const MAX_TAG_LEN = 24;

/** 标签分隔符：空格、Tab、逗号、中文顿号、分号 */
const SEPARATORS = /[\s,，、;；]+/;

/** 清洗单个标签：去 '#'、去控制字符、折叠空白、截断长度；不合法返回 '' */
export function normalizeTag(raw: string): string {
  const t = (raw ?? '')
    .replace(/^#+/, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  return t.length > MAX_TAG_LEN ? t.slice(0, MAX_TAG_LEN).trim() : t;
}

/**
 * 把一段输入（可能含多个分隔符）解析为标签数组：清洗 → 去重（大小写不敏感）→ 保序。
 * 用于「标签输入框回车」与粘贴多标签的场景。
 */
export function parseTagInput(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of String(raw ?? '').split(SEPARATORS)) {
    const tag = normalizeTag(piece);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** 合并一组标签：清洗 + 去重（大小写不敏感）+ 保序；已有标签在前 */
export function mergeTags(...groups: ReadonlyArray<ReadonlyArray<string>>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const raw of group ?? []) {
      const tag = normalizeTag(raw);
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

/** 从标签集合中移除一个（大小写不敏感） */
export function removeTag(tags: ReadonlyArray<string>, target: string): string[] {
  const key = normalizeTag(target).toLowerCase();
  if (!key) return mergeTags(tags);
  return mergeTags(tags).filter((t) => t.toLowerCase() !== key);
}

/** 该标签集合里是否含有目标标签（大小写不敏感） */
export function hasTag(tags: ReadonlyArray<string>, target: string): boolean {
  const key = normalizeTag(target).toLowerCase();
  if (!key) return false;
  return tags.some((t) => t.toLowerCase() === key);
}

export interface TagCount {
  tag: string;
  count: number;
}

/**
 * 统计标签出现次数（大小写不敏感合并，展示用首次出现的写法），按次数倒序、同数按名称排序。
 * deleted 的笔记不应传入（由调用方过滤）。
 */
export function countTags(notes: ReadonlyArray<{ tags: ReadonlyArray<string> }>): TagCount[] {
  const counts = new Map<string, TagCount>();
  for (const note of notes) {
    for (const tag of mergeTags(note.tags)) {
      const key = tag.toLowerCase();
      const cur = counts.get(key);
      if (cur) cur.count += 1;
      else counts.set(key, { tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) =>
    b.count !== a.count ? b.count - a.count : a.tag.localeCompare(b.tag),
  );
}
