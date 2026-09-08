// index.ts —— 纯文本化与索引条目构建（索引维护的纯函数部分）
import type { IndexEntry, NoteDoc } from './types.ts';

/** 取正文纯文本（供索引/摘要；剥离 markdown 符号但保留可读内容） */
export function plainTextOf(md: string): string {
  return (md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+\[[ xX]\]\s*/gm, '')
    .replace(/^[-*+]\s*/gm, '')
    .replace(/^\d+\.\s*/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 由文档构建索引条目（每次保存后重建该条，个人笔记量级下足够即时） */
export function entryFromDoc(doc: NoteDoc): IndexEntry {
  return {
    id: doc.id,
    folder: doc.folder,
    title: doc.title,
    updatedAt: doc.updatedAt,
    tags: doc.tags,
    bodyText: plainTextOf(doc.body),
    bodyRaw: doc.body,
    deleted: doc.deleted ?? false,
  };
}

/** 按 folder 统计数量（只统计出现过的 folder） */
export function countByFolder(items: ReadonlyArray<{ folder: string }>): Record<string, number> {
  const map: Record<string, number> = {};
  for (const it of items) {
    map[it.folder] = (map[it.folder] ?? 0) + 1;
  }
  return map;
}
