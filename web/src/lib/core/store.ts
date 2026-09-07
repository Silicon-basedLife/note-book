// store.ts —— NoteCore：单一事实源（文件读写 + 索引 + 搜索 + 事件广播）
// 对应 docs/TECH_DESIGN.md §2 Core 层职责（TS 侧同构实现，未来可由 Tauri/Rust
// 核心以同接口替换）；UI（主窗口/未来悬浮窗）只经 core-client 订阅同一份数据。
import { docFromContent, serializeDoc } from './frontmatter.ts';
import { entryFromDoc } from './index.ts';
import { uid } from './id.ts';
import { searchIndex } from './search.ts';
import { toggleTask as toggleBodyTask } from './tasks.ts';
import { DEFAULT_FOLDER, type CoreEvent, type CoreListener, type IndexEntry, type NewNoteInput, type NoteDoc, type OpResult, type SearchHit, type UpdateNotePatch } from './types.ts';
import { idFromFileName, META_FOLDERS, noteFileName, type StoragePort } from './storage/port.ts';

function nowIso(now: () => number): string {
  return new Date(now()).toISOString();
}

export interface NoteCoreOptions {
  /** 时钟（测试注入用） */
  now?: () => number;
}

/** 启动扫描时的容错项：解析失败的原始文件信息（桌面端可用作冲突提示） */
export interface ScanIssue {
  name: string;
  error: string;
}

export class NoteCore {
  private port: StoragePort;
  private now: () => number;
  private docs = new Map<string, NoteDoc>();
  private entries = new Map<string, IndexEntry>();
  private folders: string[] = [];
  private listeners = new Set<CoreListener>();
  private readyFlag = false;
  private issues: ScanIssue[] = [];

  constructor(port: StoragePort, opts: NoteCoreOptions = {}) {
    this.port = port;
    this.now = opts.now ?? Date.now;
  }

  get ready(): boolean {
    return this.readyFlag;
  }

  get scanIssues(): ReadonlyArray<ScanIssue> {
    return this.issues;
  }

  // ---------- 生命周期 ----------

  /** 启动：扫描笔记文件建索引；运行期靠统一的写入口增量维护（桌面版将由文件监听增量触发）。 */
  async init(): Promise<void> {
    this.issues = [];
    const folders = await this.readFoldersMeta();
    this.folders = folders.length > 0 ? folders : [DEFAULT_FOLDER];

    const names = await this.port.listNoteFiles();
    const now = nowIso(this.now);
    for (const name of names) {
      const id = idFromFileName(name);
      if (!id) continue;
      try {
        const content = await this.port.readNoteFile(name);
        if (content === null) continue;
        const doc = docFromContent(content, { fallbackId: id, nowIso: now });
        this.docs.set(doc.id, doc);
        this.entries.set(doc.id, entryFromDoc(doc));
        this.ensureFolderListed(doc.folder, false);
      } catch (err) {
        this.issues.push({ name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    this.readyFlag = true;
    this.emit({ type: 'ready', folders: this.listFolders() });
  }

  private async readFoldersMeta(): Promise<string[]> {
    try {
      const raw = await this.port.readMeta(META_FOLDERS);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
      }
    } catch {
      /* 元数据损坏则回退默认 */
    }
    return [];
  }

  private async persistFolders(): Promise<void> {
    await this.port.writeMeta(META_FOLDERS, JSON.stringify(this.folders));
  }

  /** 确保某文件夹出现在列表中（可选持久化） */
  private ensureFolderListed(folder: string, persist: boolean): void {
    if (!folder || this.folders.includes(folder)) return;
    this.folders.push(folder);
    if (persist) void this.persistFolders();
  }

  // ---------- 事件 ----------

  on(listener: CoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: CoreEvent): void {
    for (const l of [...this.listeners]) l(event);
  }

  // ---------- 查询 ----------

  listFolders(): string[] {
    return [...this.folders];
  }

  /** 文件夹数量统计（含 0 条的空文件夹） */
  counts(): Record<string, number> {
    const map: Record<string, number> = {};
    for (const f of this.folders) map[f] = 0;
    for (const doc of this.docs.values()) {
      map[doc.folder] = (map[doc.folder] ?? 0) + 1;
    }
    return map;
  }

  /** 列表查询：folder 为空/“全部”时返回全部，按更新时间倒序 */
  listNotes(folder?: string | null): NoteDoc[] {
    const out: NoteDoc[] = [];
    for (const doc of this.docs.values()) {
      if (folder && doc.folder !== folder) continue;
      out.push({ ...doc });
    }
    return out.sort((a, b) => {
      const c = b.updatedAt.localeCompare(a.updatedAt);
      return c !== 0 ? c : a.id.localeCompare(b.id);
    });
  }

  getNote(id: string): NoteDoc | undefined {
    const doc = this.docs.get(id);
    return doc ? { ...doc } : undefined;
  }

  /** 全文搜索：search(query, folder?) */
  search(query: string, folder?: string | null): SearchHit[] | null {
    const all = [...this.entries.values()];
    return searchIndex(all, query, folder);
  }

  // ---------- 笔记写操作（文件与索引同步的唯一入口） ----------

  async createNote(input: NewNoteInput = {}): Promise<NoteDoc> {
    const folder = (input.folder || '').trim() || DEFAULT_FOLDER;
    this.ensureFolderListed(folder, true);
    const ts = nowIso(this.now);
    const doc: NoteDoc = {
      id: uid(),
      folder,
      title: (input.title ?? '').trim(),
      tags: [],
      pinned: false,
      createdAt: ts,
      updatedAt: ts,
      body: input.body ?? '',
      extra: [],
    };
    await this.port.writeNoteFile(noteFileName(doc.id), serializeDoc(doc));
    this.docs.set(doc.id, doc);
    this.entries.set(doc.id, entryFromDoc(doc));
    this.emit({ type: 'note', op: 'created', note: { ...doc } });
    return { ...doc };
  }

  async updateNote(id: string, patch: UpdateNotePatch): Promise<NoteDoc | null> {
    const doc = this.docs.get(id);
    if (!doc) return null;
    const next: NoteDoc = {
      ...doc,
      title: patch.title !== undefined ? patch.title : doc.title,
      body: patch.body !== undefined ? patch.body : doc.body,
      pinned: patch.pinned !== undefined ? patch.pinned : doc.pinned,
      tags: patch.tags !== undefined ? patch.tags : doc.tags,
      folder: patch.folder !== undefined ? (patch.folder.trim() || DEFAULT_FOLDER) : doc.folder,
    };
    // 标题/正文/置顶/标签变化才刷新 updatedAt；仅移动文件夹不改变内容时间
    const touched =
      (patch.title !== undefined && patch.title !== doc.title) ||
      (patch.body !== undefined && patch.body !== doc.body) ||
      (patch.pinned !== undefined && patch.pinned !== doc.pinned) ||
      (patch.tags !== undefined && JSON.stringify(patch.tags) !== JSON.stringify(doc.tags));
    if (touched) next.updatedAt = nowIso(this.now);
    this.ensureFolderListed(next.folder, true);

    await this.port.writeNoteFile(noteFileName(next.id), serializeDoc(next));
    this.docs.set(next.id, next);
    this.entries.set(next.id, entryFromDoc(next));
    this.emit({ type: 'note', op: 'updated', note: { ...next } });
    return { ...next };
  }

  async deleteNote(id: string): Promise<boolean> {
    if (!this.docs.has(id)) return false;
    const doc = this.docs.get(id)!;
    await this.port.removeNoteFile(noteFileName(id));
    this.docs.delete(id);
    this.entries.delete(id);
    this.emit({ type: 'note', op: 'deleted', note: { ...doc } });
    return true;
  }

  /** 预览勾选待办 → 回写源文（任务行校验/越界保护见 tasks.ts） */
  async toggleTask(id: string, offset: number): Promise<boolean> {
    const doc = this.docs.get(id);
    if (!doc) return false;
    const body = toggleBodyTask(doc.body, offset);
    if (body === doc.body) return false;
    await this.updateNote(id, { body });
    return true;
  }

  // ---------- 文件夹写操作 ----------

  async createFolder(name: string): Promise<OpResult> {
    const folder = name.trim();
    if (!folder) return { ok: false, reason: '文件夹名不能为空' };
    if (this.folders.includes(folder)) return { ok: false, reason: `文件夹「${folder}」已存在` };
    this.folders.push(folder);
    await this.persistFolders();
    this.emit({ type: 'folders', op: 'created', folders: this.listFolders() });
    return { ok: true };
  }

  async renameFolder(from: string, to: string): Promise<OpResult> {
    const target = to.trim();
    if (!this.folders.includes(from)) return { ok: false, reason: '源文件夹不存在' };
    if (!target) return { ok: false, reason: '文件夹名不能为空' };
    if (target !== from && this.folders.includes(target)) {
      return { ok: false, reason: `文件夹「${target}」已存在` };
    }
    // 逐条把归属该文件夹的笔记改为新文件夹（仅元数据变更，不刷新笔记 updatedAt）
    const moved: NoteDoc[] = [];
    for (const doc of this.docs.values()) {
      if (doc.folder !== from) continue;
      await this.updateNote(doc.id, { folder: target });
      moved.push(doc);
    }
    this.folders = this.folders.map((f) => (f === from ? target : f));
    await this.persistFolders();
    this.emit({ type: 'folders', op: 'renamed', folders: this.listFolders() });
    void moved;
    return { ok: true };
  }

  async deleteFolder(name: string): Promise<OpResult> {
    if (name === DEFAULT_FOLDER) return { ok: false, reason: `「${DEFAULT_FOLDER}」为默认文件夹，不能删除` };
    if (!this.folders.includes(name)) return { ok: false, reason: '文件夹不存在' };
    if (this.folders.length <= 1) return { ok: false, reason: '至少保留一个文件夹' };
    const moved: NoteDoc[] = [];
    for (const doc of this.docs.values()) {
      if (doc.folder !== name) continue;
      await this.updateNote(doc.id, { folder: DEFAULT_FOLDER });
      moved.push(doc);
    }
    this.folders = this.folders.filter((f) => f !== name);
    await this.persistFolders();
    this.emit({ type: 'folders', op: 'deleted', folders: this.listFolders() });
    void moved;
    return { ok: true };
  }
}
