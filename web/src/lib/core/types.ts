// types.ts —— 核心数据模型与事件契约
// 对应 docs/TECH_DESIGN.md §3 存储与数据模型：一条笔记一个 .md 文件 + frontmatter。

/** 默认（收件箱）文件夹 */
export const DEFAULT_FOLDER = '收件箱';

/** frontmatter 中未识别的扩展条目，原样保留以便未来字段（P1 等）无损往返 */
export interface FrontmatterEntry {
  key: string;
  value: string;
}

/** 一条笔记的完整文档模型（frontmatter 元数据 + 正文） */
export interface NoteDoc {
  id: string;
  folder: string;
  title: string;
  tags: string[];
  pinned: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  /** 正文（frontmatter 之后的原始 markdown 文本，逐字节保留） */
  body: string;
  /** frontmatter 中除规范字段外的扩展条目（保持顺序） */
  extra: FrontmatterEntry[];
}

/** 新建笔记入参 */
export interface NewNoteInput {
  folder?: string;
  title?: string;
  body?: string;
}

/** 局部更新入参 */
export interface UpdateNotePatch {
  title?: string;
  body?: string;
  folder?: string;
  pinned?: boolean;
  tags?: string[];
}

/** 索引条目（供搜索/列表使用；纯文本正文来自 body 剥离 markdown） */
export interface IndexEntry {
  id: string;
  folder: string;
  title: string;
  updatedAt: string;
  tags: string[];
  /** 纯文本正文（去掉 markdown 语法），用于全文搜索 */
  bodyText: string;
  /** 原始正文，用于搜索结果片段定位 */
  bodyRaw: string;
}

/** 搜索结果命中 */
export interface SearchHit {
  noteId: string;
  folder: string;
  title: string;
  updatedAt: string;
  /** 命中位置：标题优先于正文 */
  where: 'title' | 'body';
  /** 已做 HTML 转义、含 <mark> 高亮的片段 */
  snippet: string;
}

/** 文件夹操作结果 */
export interface OpResult {
  ok: boolean;
  reason?: string;
}

/** 核心广播事件（P0 单窗口已启用；P1 悬浮窗据此订阅同一份数据） */
export type CoreEvent =
  | { type: 'ready'; folders: string[] }
  | { type: 'note'; op: 'created' | 'updated' | 'deleted'; note: NoteDoc }
  | { type: 'folders'; op: 'created' | 'renamed' | 'deleted'; folders: string[] };

export type CoreListener = (event: CoreEvent) => void;
