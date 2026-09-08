// store.ts —— NoteCore：单一事实源（文件读写 + 索引 + 搜索 + 回收站 + 排序 + 事件广播）
// 对应 docs/TECH_DESIGN.md §2 Core 层职责（TS 侧同构实现，未来可由 Tauri/Rust
// 核心以同接口替换）；UI（主窗口/未来悬浮窗）只经 core-client 订阅同一份数据。
// 回收站：删除=软删除（frontmatter 写入 deleted:true/deletedAt），文件保留、结构/元数据不变，
// 可还原或彻底删除；文件夹删除把其笔记一并移入回收站。
// 排序：文件夹顺序直接持久化；笔记手排以元数据 { scope -> [id...] } 记录，scope=文件夹名或 'all'。
import { docFromContent, serializeDoc } from './frontmatter.ts';
import { entryFromDoc } from './index.ts';
import { uid } from './id.ts';
import { searchIndex } from './search.ts';
import { toggleTask as toggleBodyTask } from './tasks.ts';
import {
  DEFAULT_FOLDER,
  type CoreEvent,
  type CoreListener,
  type IndexEntry,
  type NewNoteInput,
  type NoteDoc,
  type OpResult,
  type SearchHit,
  type TrashFolderInfo,
  type UpdateNotePatch,
} from './types.ts';
import {
  idFromFileName,
  META_FOLDERS,
  noteFileName,
  type StoragePort,
} from './storage/port.ts';

const META_DELETED_FOLDERS = 'trash.folders';
const META_NOTE_ORDER = 'order.notes';
/** “全部笔记”视图的手排作用域 */
export const SCOPE_ALL = 'all';

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
  private deletedFolders: string[] = [];
  private noteOrder: Record<string, string[]> = {};
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

  /** 启动：扫描笔记文件建索引（含回收站条目）；运行期靠统一写入口增量维护。 */
  async init(): Promise<void> {
    this.issues = [];
    const folders = await this.readMetaArray(META_FOLDERS);
    this.folders = folders.length > 0 ? folders : [DEFAULT_FOLDER];
    this.deletedFolders = await this.readMetaArray(META_DELETED_FOLDERS);
    this.noteOrder = await this.readNoteOrderMeta();

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
        // 回收站中的笔记不再把其文件夹“复活”到活跃列表
        if (!doc.deleted) this.ensureFolderListed(doc.folder, false);
      } catch (err) {
        this.issues.push({ name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    this.readyFlag = true;
    this.emit({ type: 'ready', folders: this.listFolders() });
  }

  private async readMetaArray(key: string): Promise<string[]> {
    try {
      const raw = await this.port.readMeta(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
      }
    } catch {
      /* 元数据损坏则回退 */
    }
    return [];
  }

  private async readNoteOrderMeta(): Promise<Record<string, string[]>> {
    try {
      const raw = await this.port.readMeta(META_NOTE_ORDER);
      if (!raw) return {};
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string');
        }
        return out;
      }
    } catch {
      /* 忽略 */
    }
    return {};
  }

  private async persistFolders(): Promise<void> {
    await this.port.writeMeta(META_FOLDERS, JSON.stringify(this.folders));
  }

  private async persistDeletedFolders(): Promise<void> {
    await this.port.writeMeta(META_DELETED_FOLDERS, JSON.stringify(this.deletedFolders));
  }

  private async persistNoteOrder(): Promise<void> {
    await this.port.writeMeta(META_NOTE_ORDER, JSON.stringify(this.noteOrder));
  }

  /** 确保某活跃文件夹出现在列表中（可选持久化） */
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

  // ---------- 基础查询（活跃笔记，回收站除外） ----------

  listFolders(): string[] {
    return [...this.folders];
  }

  private isLive(doc: NoteDoc): boolean {
    return !doc.deleted;
  }

  /** 活跃笔记数量统计（含 0 条的空文件夹） */
  counts(): Record<string, number> {
    const map: Record<string, number> = {};
    for (const f of this.folders) map[f] = 0;
    for (const doc of this.docs.values()) {
      if (!this.isLive(doc)) continue;
      map[doc.folder] = (map[doc.folder] ?? 0) + 1;
    }
    return map;
  }

  private sortByUpdated(a: NoteDoc, b: NoteDoc): number {
    const c = b.updatedAt.localeCompare(a.updatedAt);
    return c !== 0 ? c : a.id.localeCompare(b.id);
  }

  private liveDocsIn(folder?: string | null): NoteDoc[] {
    const out: NoteDoc[] = [];
    for (const doc of this.docs.values()) {
      if (!this.isLive(doc)) continue;
      if (folder && doc.folder !== folder) continue;
      out.push({ ...doc });
    }
    return out.sort((a, b) => this.sortByUpdated(a, b));
  }

  /** 列表查询（活跃）：folder 为空/“全部”时返回全部，默认按更新时间倒序 */
  listNotes(folder?: string | null): NoteDoc[] {
    return this.liveDocsIn(folder);
  }

  /** 按作用域取活跃笔记列表；若该作用域存在手排顺序则优先手排，新增笔记追加在末尾 */
  listNotesOrdered(scope: string): NoteDoc[] {
    const folder = scope === SCOPE_ALL ? null : scope;
    const base = this.liveDocsIn(folder);
    const order = this.noteOrder[scope];
    if (!order || order.length === 0) return base;
    const byId = new Map(base.map((d) => [d.id, d]));
    const head: NoteDoc[] = [];
    for (const id of order) {
      const doc = byId.get(id);
      if (!doc) continue;
      head.push(doc);
      byId.delete(id);
    }
    const rest = [...byId.values()].sort((a, b) => this.sortByUpdated(a, b));
    return [...head, ...rest];
  }

  getNote(id: string): NoteDoc | undefined {
    const doc = this.docs.get(id);
    return doc ? { ...doc } : undefined;
  }

  /** 全文搜索（活跃笔记）。opts.includeTrash=true 时把回收站命中一并返回（hit.deleted=true）。 */
  search(
    query: string,
    folder?: string | null,
    opts?: { includeTrash?: boolean }
  ): SearchHit[] | null {
    const entries: IndexEntry[] = [];
    for (const entry of this.entries.values()) {
      if (folder && entry.folder !== folder) continue;
      if (!opts?.includeTrash && entry.deleted) continue;
      entries.push(entry);
    }
    return searchIndex(entries, query);
  }

  // ---------- 笔记写操作（文件与索引同步的唯一入口） ----------

  private async persistDoc(next: NoteDoc): Promise<void> {
    await this.port.writeNoteFile(noteFileName(next.id), serializeDoc(next));
    this.docs.set(next.id, next);
    this.entries.set(next.id, entryFromDoc(next));
  }

  /** 手排数组维护：从旧文件夹作用域移除、追加到新文件夹尾部（仅当存在手排时）。
   *  注意：不修改 'all'（全部）作用域 —— 它代表整个库的顺序，跨文件夹移动不改变其成员。 */
  private async adjustOrderOnMove(id: string, fromFolder: string, toFolder: string): Promise<void> {
    let changed = false;
    const from = this.noteOrder[fromFolder];
    if (from && from.includes(id)) {
      this.noteOrder[fromFolder] = from.filter((x) => x !== id);
      changed = true;
    }
    if (this.noteOrder[toFolder]) {
      const arr = this.noteOrder[toFolder].filter((x) => x !== id);
      this.noteOrder[toFolder] = [...arr, id];
      changed = true;
    }
    if (changed) await this.persistNoteOrder();
  }

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
    await this.persistDoc(doc);
    // 存在手排的作用域：新笔记追加到末尾（保持用户排序稳定）
    let changed = false;
    for (const scope of [folder, SCOPE_ALL]) {
      const arr = this.noteOrder[scope];
      if (arr && !arr.includes(doc.id)) {
        this.noteOrder[scope] = [...arr, doc.id];
        changed = true;
      }
    }
    if (changed) await this.persistNoteOrder();
    this.emit({ type: 'note', op: 'created', note: { ...doc } });
    return { ...doc };
  }

  async updateNote(id: string, patch: UpdateNotePatch): Promise<NoteDoc | null> {
    const doc = this.docs.get(id);
    if (!doc) return null;
    if (doc.deleted && patch.folder !== undefined) {
      // 回收站笔记不允许被当作活跃笔记移动
      return { ...doc };
    }
    const folderChanged = patch.folder !== undefined && patch.folder.trim() !== doc.folder;
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
    if (folderChanged) this.ensureFolderListed(next.folder, true);

    await this.persistDoc(next);
    if (folderChanged) await this.adjustOrderOnMove(id, doc.folder, next.folder);
    this.emit({ type: 'note', op: 'updated', note: { ...next } });
    return { ...next };
  }

  /** 把笔记移入回收站（软删除：frontmatter 写入 deleted/deletedAt，文件保留） */
  async deleteNote(id: string): Promise<boolean> {
    return (await this.deleteNotes([id])) === 1;
  }

  /** 批量移入回收站；返回实际处理条数 */
  async deleteNotes(ids: string[]): Promise<number> {
    let done = 0;
    const ts = nowIso(this.now);
    for (const id of ids) {
      const doc = this.docs.get(id);
      if (!doc || doc.deleted) continue;
      const next: NoteDoc = { ...doc, deleted: true, deletedAt: ts };
      await this.persistDoc(next);
      this.emit({ type: 'note', op: 'deleted', note: { ...next } });
      done += 1;
    }
    return done;
  }

  /** 从回收站还原（其文件夹若也在回收站中则一并复活） */
  async restoreNote(id: string): Promise<boolean> {
    const doc = this.docs.get(id);
    if (!doc || !doc.deleted) return false;
    if (this.deletedFolders.includes(doc.folder)) {
      // 文件夹在回收站里 → 一并还原
      await this.restoreFolderInternal(doc.folder, false);
    }
    const next: NoteDoc = { ...doc };
    delete next.deleted;
    delete next.deletedAt;
    if (!this.folders.includes(next.folder)) this.ensureFolderListed(next.folder, true);
    await this.persistDoc(next);
    this.emit({ type: 'note', op: 'restored', note: { ...next } });
    return true;
  }

  /** 从回收站彻底删除（物理移除文件并清理索引/排序引用） */
  async purgeNote(id: string): Promise<boolean> {
    const doc = this.docs.get(id);
    if (!doc || !doc.deleted) return false;
    await this.port.removeNoteFile(noteFileName(id));
    this.docs.delete(id);
    this.entries.delete(id);
    await this.pruneOrderId(id);
    this.emit({ type: 'note', op: 'purged', note: { ...doc } });
    return true;
  }

  /** 清空回收站：彻底删除全部已删笔记与已删文件夹记录 */
  async purgeTrash(): Promise<void> {
    const deleted = [...this.docs.values()].filter((d) => d.deleted);
    for (const doc of deleted) {
      await this.port.removeNoteFile(noteFileName(doc.id));
      this.docs.delete(doc.id);
      this.entries.delete(doc.id);
      this.emit({ type: 'note', op: 'purged', note: { ...doc } });
    }
    this.deletedFolders = [];
    await this.persistDeletedFolders();
    // 清理排序中已不存在的 id
    let changed = false;
    for (const scope of Object.keys(this.noteOrder)) {
      const arr = this.noteOrder[scope];
      if (!arr) continue;
      const kept = arr.filter((id) => this.docs.has(id));
      if (kept.length !== arr.length) changed = true;
      this.noteOrder[scope] = kept;
    }
    if (changed) await this.persistNoteOrder();
  }

  /** 预览勾选待办 → 回写源文（任务行校验/越界保护见 tasks.ts） */
  async toggleTask(id: string, offset: number): Promise<boolean> {
    const doc = this.docs.get(id);
    if (!doc || doc.deleted) return false;
    const body = toggleBodyTask(doc.body, offset);
    if (body === doc.body) return false;
    await this.updateNote(id, { body });
    return true;
  }

  // ---------- 回收站查询 ----------

  listTrashNotes(): NoteDoc[] {
    const out: NoteDoc[] = [];
    for (const doc of this.docs.values()) {
      if (!doc.deleted) continue;
      out.push({ ...doc });
    }
    return out.sort((a, b) => {
      const c = (b.deletedAt ?? b.updatedAt).localeCompare(a.deletedAt ?? a.updatedAt);
      return c !== 0 ? c : a.id.localeCompare(b.id);
    });
  }

  listTrashFolders(): TrashFolderInfo[] {
    const out: TrashFolderInfo[] = [];
    for (const name of this.deletedFolders) {
      let noteCount = 0;
      for (const doc of this.docs.values()) {
        if (doc.deleted && doc.folder === name) noteCount += 1;
      }
      out.push({ name, noteCount });
    }
    return out;
  }

  countsTrash(): { notes: number; folders: number } {
    let notes = 0;
    for (const doc of this.docs.values()) if (doc.deleted) notes += 1;
    return { notes, folders: this.deletedFolders.length };
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
    // 迁移手排作用域
    if (this.noteOrder[from] !== undefined) {
      this.noteOrder[target] = this.noteOrder[from];
      delete this.noteOrder[from];
      await this.persistNoteOrder();
    }
    // 逐条改文件夹归属（不刷新笔记 updatedAt）
    for (const doc of this.docs.values()) {
      if (doc.folder !== from || doc.deleted) continue;
      const next: NoteDoc = { ...doc, folder: target };
      await this.persistDoc(next);
    }
    this.folders = this.folders.map((f) => (f === from ? target : f));
    await this.persistFolders();
    this.emit({ type: 'folders', op: 'renamed', folders: this.listFolders() });
    return { ok: true };
  }

  /** 删除文件夹：连同其活跃笔记一并移入回收站（保留原始结构，可整组还原） */
  async deleteFolder(name: string): Promise<OpResult> {
    if (name === DEFAULT_FOLDER) return { ok: false, reason: `「${DEFAULT_FOLDER}」为默认文件夹，不能删除` };
    if (!this.folders.includes(name)) return { ok: false, reason: '文件夹不存在' };
    if (this.folders.length <= 1) return { ok: false, reason: '至少保留一个文件夹' };
    const ts = nowIso(this.now);
    const affected: NoteDoc[] = [];
    for (const doc of this.docs.values()) {
      if (doc.folder !== name || doc.deleted) continue;
      const next: NoteDoc = { ...doc, deleted: true, deletedAt: ts };
      await this.persistDoc(next);
      affected.push(next);
      this.emit({ type: 'note', op: 'deleted', note: { ...next } });
    }
    this.folders = this.folders.filter((f) => f !== name);
    this.deletedFolders.push(name);
    delete this.noteOrder[name];
    await this.persistFolders();
    await this.persistDeletedFolders();
    await this.persistNoteOrder();
    this.emit({ type: 'folders', op: 'deleted', folders: this.listFolders() });
    void affected;
    return { ok: true };
  }

  private async restoreFolderInternal(name: string, emitEvent: boolean): Promise<void> {
    const idx = this.deletedFolders.indexOf(name);
    if (idx < 0) return;
    this.deletedFolders.splice(idx, 1);
    if (!this.folders.includes(name)) this.folders.push(name);
    await this.persistFolders();
    await this.persistDeletedFolders();
    for (const doc of this.docs.values()) {
      if (doc.folder !== name || !doc.deleted) continue;
      const next: NoteDoc = { ...doc };
      delete next.deleted;
      delete next.deletedAt;
      await this.persistDoc(next);
      if (emitEvent) this.emit({ type: 'note', op: 'restored', note: { ...next } });
    }
    if (emitEvent) this.emit({ type: 'folders', op: 'restored', folders: this.listFolders() });
  }

  /** 还原回收站中的文件夹（及其中的笔记） */
  async restoreFolder(name: string): Promise<OpResult> {
    if (!this.deletedFolders.includes(name)) return { ok: false, reason: '文件夹不在回收站' };
    await this.restoreFolderInternal(name, true);
    return { ok: true };
  }

  /** 从回收站彻底删除整个文件夹（物理删除其笔记） */
  async purgeFolder(name: string): Promise<OpResult> {
    if (!this.deletedFolders.includes(name)) return { ok: false, reason: '文件夹不在回收站' };
    const docList = [...this.docs.values()].filter((d) => d.deleted && d.folder === name);
    for (const doc of docList) {
      await this.port.removeNoteFile(noteFileName(doc.id));
      this.docs.delete(doc.id);
      this.entries.delete(doc.id);
      this.emit({ type: 'note', op: 'purged', note: { ...doc } });
    }
    this.deletedFolders = this.deletedFolders.filter((f) => f !== name);
    delete this.noteOrder[name];
    await this.persistDeletedFolders();
    await this.persistNoteOrder();
    this.emit({ type: 'folders', op: 'deleted', folders: this.listFolders() });
    return { ok: true };
  }

  /** 拖拽排序：按给定顺序持久化文件夹列表 */
  async reorderFolders(ordered: string[]): Promise<OpResult> {
    if (ordered.length !== this.folders.length) return { ok: false, reason: '顺序不完整' };
    for (const f of ordered) {
      if (!this.folders.includes(f)) return { ok: false, reason: '顺序包含未知文件夹' };
    }
    this.folders = [...ordered];
    await this.persistFolders();
    this.emit({ type: 'folders', op: 'reordered', folders: this.listFolders() });
    return { ok: true };
  }

  // ---------- 笔记排序持久化 ----------

  /** 记录某作用域（文件夹名或 'all'）的手排 id 顺序；null 表示清空（恢复时间序） */
  async setNoteOrder(scope: string, ids: string[] | null): Promise<void> {
    if (!ids || ids.length === 0) {
      delete this.noteOrder[scope];
    } else {
      this.noteOrder[scope] = [...ids];
    }
    await this.persistNoteOrder();
  }

  getNoteOrder(scope: string): string[] | undefined {
    const arr = this.noteOrder[scope];
    return arr ? [...arr] : undefined;
  }

  private async pruneOrderId(id: string): Promise<void> {
    let changed = false;
    for (const scope of Object.keys(this.noteOrder)) {
      const arr = this.noteOrder[scope];
      if (arr && arr.includes(id)) {
        this.noteOrder[scope] = arr.filter((x) => x !== id);
        changed = true;
      }
    }
    if (changed) await this.persistNoteOrder();
  }
}
