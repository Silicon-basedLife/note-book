// search.ts —— 内存全文搜索（标题 + 正文），接口与 docs/TECH_DESIGN.md §3.3 对齐：
// search(query, folder?) → 命中列表；未来笔记量大后换 SQLite FTS5 只换后端、接口不变。
import { escapeHtml } from './html.ts';
import type { IndexEntry, SearchHit } from './types.ts';

/** 结果片段最大展示长度（超出截断并加省略号） */
const SNIPPET_LEN = 120;

/** 构建带 <mark> 高亮的转义片段 */
function markSnippet(text: string, q: string, radius: number): string {
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  const hit = lower.indexOf(ql);
  if (hit < 0) {
    const head = text.length > SNIPPET_LEN ? text.slice(0, SNIPPET_LEN) + '…' : text;
    return escapeHtml(head);
  }
  // 校验大小写/Unicode 展开不会导致切片错位，错位则放弃高亮
  const safeHit =
    text.slice(hit, hit + q.length).toLowerCase() === ql ? hit : -1;

  let start = 0;
  let end = text.length;
  if (safeHit >= 0) {
    start = Math.max(0, safeHit - radius);
    end = Math.min(text.length, safeHit + q.length + radius);
  } else if (text.length > SNIPPET_LEN) {
    start = Math.max(0, hit - radius);
    end = Math.min(text.length, hit + ql.length + radius);
  }
  const head = start > 0 ? '…' : '';
  const tail = end < text.length ? '…' : '';
  const seg = text.slice(start, end);
  if (safeHit < 0) return escapeHtml(head + seg + tail);
  const rel = safeHit - start;
  const before = escapeHtml(seg.slice(0, rel));
  const mark = escapeHtml(seg.slice(rel, rel + q.length));
  const after = escapeHtml(seg.slice(rel + q.length));
  return head + before + '<mark>' + mark + '</mark>' + after + tail;
}

function hit(entry: IndexEntry, where: 'title' | 'body', q: string): SearchHit {
  const snippet =
    where === 'title' ? markSnippet(entry.title, q, 24) : markSnippet(entry.bodyRaw || entry.bodyText, q, 48);
  return {
    noteId: entry.id,
    folder: entry.folder,
    title: entry.title,
    updatedAt: entry.updatedAt,
    where,
    snippet,
  };
}

/**
 * 全文搜索。query 为空返回 null；folder 提供时限定该文件夹。
 * 结果排序：标题命中优先于正文命中；同级按更新时间倒序。
 */
export function searchIndex(
  entries: ReadonlyArray<IndexEntry>,
  query: string,
  folder?: string | null
): SearchHit[] | null {
  const q = (query || '').trim();
  if (!q) return null;
  const ql = q.toLowerCase();
  const out: SearchHit[] = [];
  for (const entry of entries) {
    if (folder && entry.folder !== folder) continue;
    const titleHit = entry.title.toLowerCase().indexOf(ql);
    if (titleHit >= 0) {
      out.push(hit(entry, 'title', q));
      continue;
    }
    const rawHit = entry.bodyRaw.toLowerCase().indexOf(ql);
    const plainHit = entry.bodyText.toLowerCase().indexOf(ql);
    if (rawHit >= 0 || plainHit >= 0) {
      out.push(hit(entry, 'body', q));
    }
  }
  const rank = { title: 0, body: 1 } as const;
  return out.sort((a, b) => {
    const byRank = rank[a.where] - rank[b.where];
    if (byRank !== 0) return byRank;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}
