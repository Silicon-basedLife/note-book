// frontmatter.ts —— .md 文件 frontmatter 解析与序列化
// 对应 docs/TECH_DESIGN.md §3.1：文件名为稳定 ID（<id>.md），
// 文件夹/title/tags/pinned 等写入 frontmatter；未知扩展字段原样保留往返。

import { DEFAULT_FOLDER, type FrontmatterEntry, type NoteDoc } from './types.ts';

const DELIM = '---';

const KNOWN_KEYS = ['id', 'folder', 'title', 'tags', 'pinned', 'createdAt', 'updatedAt'] as const;

/** 解析 tags 值（"[]" / JSON 字符串数组），失败回退空数组 */
function parseTags(value: string): string[] {
  const v = (value ?? '').trim();
  if (!v) return [];
  try {
    const parsed: unknown = JSON.parse(v);
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    /* 非 JSON 时忽略 */
  }
  return [];
}

/** 将文件内容拆分为 frontmatter 条目列表与正文。
 *  无有效 frontmatter（不以 --- 开头或未闭合）时 entries 为 null，整篇视为正文。 */
export function splitFrontmatter(content: string): {
  entries: FrontmatterEntry[] | null;
  body: string;
} {
  const lines = content.split('\n');
  if (!lines[0] || lines[0].trim() !== DELIM) {
    return { entries: null, body: content };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line && line.trim() === DELIM) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    return { entries: null, body: content };
  }
  const entries: FrontmatterEntry[] = [];
  for (let i = 1; i < end; i++) {
    const line = lines[i] ?? '';
    if (!line.trim()) continue; // 容忍空行
    const colon = line.indexOf(':');
    if (colon <= 0) continue; // 无 key:value 结构则跳过
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    entries.push({ key, value });
  }
  // 正文从闭合行之后开始：content 中位于第 end 行结尾换行之后
  let cursor = 0;
  for (let i = 0; i <= end; i++) {
    cursor += (lines[i]?.length ?? 0) + 1;
  }
  return { entries, body: content.slice(cursor) };
}

/** 将 frontmatter 条目解析为 NoteDoc（字段缺省时给默认值；未知字段进入 extra）。 */
export function docFromContent(
  content: string,
  opts: { fallbackId: string; nowIso: string }
): NoteDoc {
  const { entries, body } = splitFrontmatter(content);
  const map = new Map<string, string>();
  const extra: FrontmatterEntry[] = [];
  if (entries) {
    for (const e of entries) {
      if ((KNOWN_KEYS as readonly string[]).includes(e.key)) map.set(e.key, e.value);
      else extra.push(e);
    }
  }
  const nowIso = opts.nowIso;
  const id = (map.get('id') || '').trim() || opts.fallbackId;
  const isoOr = (raw: string | undefined, fallback: string) => {
    const v = (raw || '').trim();
    return v && !Number.isNaN(Date.parse(v)) ? v : fallback;
  };
  return {
    id,
    folder: (map.get('folder') || '').trim() || DEFAULT_FOLDER,
    title: (map.get('title') || '').trim(),
    tags: parseTags(map.get('tags') || '[]'),
    pinned: (map.get('pinned') || '').trim() === 'true',
    createdAt: isoOr(map.get('createdAt'), nowIso),
    updatedAt: isoOr(map.get('updatedAt'), nowIso),
    body,
    extra,
  };
}

function escapeLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/** 序列化 NoteDoc → 完整 .md 文件内容（正文逐字节保留）。 */
export function serializeDoc(doc: NoteDoc): string {
  const head: FrontmatterEntry[] = [];
  head.push({ key: 'id', value: escapeLine(doc.id) });
  head.push({ key: 'folder', value: escapeLine(doc.folder) });
  head.push({ key: 'title', value: escapeLine(doc.title) });
  head.push({ key: 'tags', value: JSON.stringify(doc.tags) });
  head.push({ key: 'pinned', value: String(doc.pinned) });
  head.push({ key: 'createdAt', value: doc.createdAt });
  head.push({ key: 'updatedAt', value: doc.updatedAt });
  for (const e of doc.extra) {
    if (!(KNOWN_KEYS as readonly string[]).includes(e.key)) head.push(e);
  }
  const lines = [DELIM, ...head.map((e) => `${e.key}: ${e.value}`), DELIM];
  return lines.join('\n') + '\n' + doc.body;
}
