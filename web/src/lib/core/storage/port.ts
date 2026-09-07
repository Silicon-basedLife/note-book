// storage/port.ts —— 可插拔存储端口（核心唯一的 I/O 通道）
// 对应 docs/TECH_DESIGN.md §2：Core 为唯一事实源；本端口是数据层的接缝——
// - 桌面版（未来 Tauri 壳）：由 Rust core / fs 适配器实现为真实磁盘读写
//   （%APPDATA%\<app>\notes\<id>.md，frontmatter 与内容布局完全一致）；
// - Web 版：IndexedDB 虚拟文件系统（browser-idb.ts），key = "<id>.md"；
// - 测试/演示：内存实现（memory.ts）。

export interface StoragePort {
  /** 列出全部笔记文件名（形如 <id>.md） */
  listNoteFiles(): Promise<string[]>;
  readNoteFile(name: string): Promise<string | null>;
  writeNoteFile(name: string, content: string): Promise<void>;
  removeNoteFile(name: string): Promise<void>;
  /** 应用级元数据（键值，如文件夹列表），与笔记文件分开存放 */
  readMeta(key: string): Promise<string | null>;
  writeMeta(key: string, value: string): Promise<void>;
  removeMeta(key: string): Promise<void>;
}

export const NOTE_EXT = '.md';

/** 稳定 ID → 文件名（技术方案：文件名即 ID，重命名/移动只改元数据） */
export function noteFileName(id: string): string {
  return id + NOTE_EXT;
}

/** 文件名 → 笔记 ID（非笔记文件返回 null） */
export function idFromFileName(name: string): string | null {
  return name.toLowerCase().endsWith(NOTE_EXT) ? name.slice(0, -NOTE_EXT.length) : null;
}

/** 元数据 key：文件夹列表 */
export const META_FOLDERS = 'folders';
