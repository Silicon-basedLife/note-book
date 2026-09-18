<script lang="ts">
  // App.svelte —— NoteApp 主窗口（三栏：文件夹 / 笔记列表 / 编辑+预览）
  // P0 功能 + 增强版交互：文件夹右键菜单/悬停删除/拖拽排序、笔记多选批量进回收站、
  // 笔记拖拽移动/手排、回收站（还原/彻底删除/清空）、左侧收边窄条。
  import { onMount } from 'svelte';
  import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
  import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
  import ContextMenu from './ui/ContextMenu.svelte';
  import { SideDock } from '../lib/desktop/side-dock.ts';
  import { createCore, displayTitle, excerptOf } from '../shared/core-client.ts';
  import { renderMarkdown } from '../lib/core/markdown.ts';
  import { plainTextOf } from '../lib/core/index.ts';
  import { relativeTime } from '../lib/core/format.ts';
  import { SCOPE_ALL } from '../lib/core/store.ts';
  import { collectTodos, countTodos, filterTodos, type TodoItem } from '../lib/core/todos.ts';
  import {
    countTags, hasTag, mergeTags, normalizeTag, parseTagInput, removeTag, type TagCount,
  } from '../lib/core/tags.ts';
  import { ActionRegistry, type ActionDef, type Shortcut } from '../lib/core/actions.ts';
  import type { NoteCore } from '../lib/core/store.ts';
  import type { NoteDoc, SearchHit, TrashFolderInfo } from '../lib/core/types.ts';
  import { DEFAULT_SETTINGS, type AppSettings } from '../lib/settings/types.ts';
  import { ACTIONS as ACTION_CATALOG } from '../lib/settings/catalog.ts';
  import { effectiveShortcuts } from '../lib/settings/shortcuts.ts';
  import { loadSettings, saveSettings, subscribeSettings } from '../lib/settings/store.ts';
  import { ThemeFollower } from '../lib/desktop/theme.ts';

  // ---------- 类型 ----------
  interface ListItem {
    id: string;
    folder: string;
    title: string;
    updatedAt: string;
    deletedAt?: string;
    excerpt?: string;
    snippet?: string;
    where?: 'title' | 'body';
    hit?: boolean;
    deleted?: boolean;
    /** 置顶（列表按置顶分区排序，置顶项恒在最前） */
    pinned?: boolean;
    tags?: string[];
  }
  interface ToastItem { id: number; text: string }
  interface ConfirmState {
    title: string;
    message: string;
    okLabel?: string;
    danger?: boolean;
    onOk: () => void | Promise<void>;
  }
  interface PromptState {
    title: string;
    placeholder?: string;
    value: string;
    okLabel?: string;
    onOk: (v: string) => void | Promise<void>;
  }
  interface CtxItem { id: string; label: string; icon?: string; danger?: boolean; disabled?: boolean; onClick: () => void }
  interface CtxState { x: number; y: number; rows: Array<CtxItem | { type: 'sep' }> }

  // ---------- 全局状态 ----------
  let core: NoteCore;
  let dock: SideDock | null = null; // QQ 式侧边吸附（仅桌面 Tauri）
  let ready = $state(false);
  let folders = $state<string[]>([]);
  let counts = $state<Record<string, number>>({});
  let activeFolder = $state<string | null>(null); // null = 全部
  let view = $state<'notes' | 'trash' | 'todos'>('notes');
  /** 待办聚合视图：是否连带显示已完成 */
  let showDoneTodos = $state(false);
  /** 从聚合视图跳转到某条任务后，短暂高亮该行 */
  let todoHighlight = $state<{ id: string; offset: number } | null>(null);
  let todoHighlightTimer: ReturnType<typeof setTimeout> | undefined;
  let trashCounts = $state<{ notes: number; folders: number }>({ notes: 0, folders: 0 });
  let trashFolders = $state<TrashFolderInfo[]>([]);
  let query = $state('');
  /** 标签筛选（大小写不敏感等值匹配）；null = 不筛选 */
  let tagFilter = $state<string | null>(null);
  /** 标签输入框的待提交文本 */
  let tagDraft = $state('');
  let mode = $state<'edit' | 'split' | 'preview'>('split');
  let listItems = $state<ListItem[]>([]);
  /** 未按标签过滤的列表（标签筛选条据此统计；listItems 是其过滤结果） */
  let listItemsBase = $state<ListItem[]>([]);
  let currentId = $state<string | null>(null);
  let current = $state<{ id: string; title: string; body: string; folder: string; updatedAt: string; pinned: boolean; tags: string[]; deleted?: boolean; deletedAt?: string } | null>(null);
  let saveState = $state<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  let lastSavedAt = $state<string | null>(null);
  let toasts = $state<ToastItem[]>([]);
  let confirm = $state<ConfirmState | null>(null);
  let prompt = $state<PromptState | null>(null);
  let helpOpen = $state(false);
  let ctx = $state<CtxState | null>(null);
  let renamingFolder = $state<string | null>(null);
  let renameValue = $state('');
  let selectionMode = $state(false);
  let selectedIds = $state<string[]>([]);
  let selAnchor: string | null = null;
  let manualScope = $state<string | null>(null); // 当前列表手排作用域（null=时间序或非笔记视图）
  // 面板级联开合：默认仅侧栏（图3）；点文件夹滑出笔记列（图4）；点笔记滑出编辑区（图5）
  let listOpen = $state(false);
  let editorOpen = $state(false);
  let searchEl = $state<HTMLInputElement | null>(null);
  let previewEl = $state<HTMLElement | null>(null);

  // 拖拽状态
  let draggingNoteIds = $state<string[] | null>(null);
  let overFolderName = $state<string | null>(null);  // 侧栏高亮的目标文件夹
  let overTrash = $state(false);                     // 拖到回收站入口高亮
  let dropLineIdx = $state<number | null>(null);     // 中间列表插入线位置
  let dragFolderIdx = $state<number | null>(null);   // 正在拖拽的文件夹下标
  let folderDropIdx = $state<number | null>(null);   // 文件夹排序插入位置（0..len）
  // 指针拖拽（鼠标按下→移动→松开），不依赖 HTML5 拖放
  let ptDown: { kind: 'note' | 'folder'; ids: string[]; fromIdx: number | null; x: number; y: number; active: boolean } | null = null;
  let suppressClick = false;

  // 应用设置（桌面：settings.json；Web：localStorage）
  let settings = $state<AppSettings>(structuredClone(DEFAULT_SETTINGS));
  let registry = $state<ActionRegistry>(new ActionRegistry());
  let unsubSettings: (() => void) | undefined;
  let panelsSaveTimer: ReturnType<typeof setTimeout> | undefined;
  // 主题运行时：只在「跟随系统」时订阅 prefers-color-scheme 变化，切档自动换订阅
  const themeFollower = new ThemeFollower();

  // ---------- 计算 ----------
  const isDeletedCurrent = $derived(!!current?.deleted);
  const previewRender = $derived(
    mode !== 'edit' && current
      ? renderMarkdown(current.body)
      : null
  );
  const previewTasks = $derived(previewRender?.tasks ?? []);
  const totalNotes = $derived(Object.values(counts).reduce((a, b) => a + b, 0));
  const currentScope = $derived(view === 'notes' && !query.trim() ? (activeFolder ?? SCOPE_ALL) : null);
  /**
   * 标签筛选条的统计来源：显式放在 state 里，由 refresh() 统一更新
   * （Svelte 5 不追踪 $derived 里被调用函数内部读取的状态，所以不能写成 core.listNotesOrdered(...)）。
   * 取“全部笔记”而非当前文件夹：标签是跨文件夹的导航维度，只统计当前文件夹会让筛选条
   * 在单篇文件夹里消失，用户也就无从切换标签。
   */
  let allTags = $state<TagCount[]>([]);
  const tagChips = $derived(view === 'notes' && !query.trim() ? allTags : ([] as TagCount[]));
  const tagFilterLabel = $derived(tagFilter ?? '');
  const pinnedCount = $derived(listItems.filter((it) => it.pinned).length);
  /** 置顶分区可能存在：此时禁止跨分区拖拽排序（否则手排会与置顶分区互相打架） */
  const hasPinnedInList = $derived(pinnedCount > 0);
  /** 待办聚合结果与角标（refresh 里更新） */
  let todoItems = $state<TodoItem[]>([]);
  let todoCounts = $state<{ open: number; done: number }>({ open: 0, done: 0 });
  /** 聚合视图里实际渲染的清单（受“显示已完成”与搜索框影响） */
  const visibleTodos = $derived(filterTodos(todoItems, query));

  // 诊断钩子：仅在 Web 预览（非 Tauri）下挂到 window，便于冒烟/排障观察派生状态
  if (!isTauri()) {
    (window as unknown as Record<string, unknown>).__diag = () => ({
      view,
      activeFolder,
      query,
      listItemTags: listItemsBase.map((it) => [it.title, it.tags ?? []]),
      noteTags: core ? core.listNotes(activeFolder).map((d) => [d.title, d.tags, d.folder, d.pinned]) : null,
      listNotesAll: core ? core.listNotes(null).map((d) => [d.title, d.folder]) : null,
      tagChips,
      tagFilter,
    });
  }

  // ---------- 通用 ----------
  function toast(text: string) {
    const id = Date.now() + Math.floor(Math.random() * 1e4);
    toasts = [...toasts, { id, text }];
    setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); }, 2400);
  }
  function formatShortcut(s?: Shortcut): string {
    if (!s) return '';
    const mods: string[] = [];
    if (s.meta) mods.push('Meta');
    if (s.ctrl) mods.push('Ctrl');
    if (s.alt) mods.push('Alt');
    if (s.shift) mods.push('Shift');
    const key = s.key.length === 1 ? s.key.toUpperCase() : s.key;
    return [...mods, key].join(' + ');
  }
  function displayShortcut(def: ActionDef): string {
    return def.shortcut ? formatShortcut(def.shortcut) : '';
  }
  function closeCtx() { ctx = null; }

  // ---------- 保存（去抖；写队列串行化） ----------
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  let saveQueued = false;
  function scheduleSave() {
    if (saveQueued) return;
    saveQueued = true;
    chain = chain.then(doSave).finally(() => { saveQueued = false; });
  }
  async function doSave() {
    const id = currentId;
    const title = current?.title ?? '';
    const body = current?.body ?? '';
    if (!id || current?.deleted) { saveState = 'saved'; return; }
    saveState = 'saving';
    try {
      const doc = await core.updateNote(id, { title, body });
      if (doc && current && current.id === id) {
        current.updatedAt = doc.updatedAt;
        if (saveState === 'saving') {
          saveState = 'saved';
          lastSavedAt = new Date().toISOString();
        }
      }
    } catch (err) {
      if (current) {
        saveState = 'dirty';
        toast('保存失败：' + (err instanceof Error ? err.message : String(err)));
      }
    }
  }
  function markDirty() {
    if (current?.deleted) return;
    saveState = 'dirty';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = undefined; scheduleSave(); }, Math.max(100, settings.editor.autoSaveMs));
  }
  async function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = undefined; }
    if (saveState === 'dirty') scheduleSave();
    await chain;
  }

  // ---------- 数据刷新 ----------
  function refresh() {
    if (!core) return;
    folders = core.listFolders();
    counts = core.counts();
    trashCounts = core.countsTrash();
    trashFolders = core.listTrashFolders();
    const q = query.trim();

    if (view === 'todos') {
      // 待办聚合：读所有活跃笔记的正文，按行扫描汇总（未完成默认在前；showDoneTodos 时带上已完成）
      const docs = core.listNotes();
      const sources = docs.map((n) => ({
        id: n.id, title: n.title, folder: n.folder, updatedAt: n.updatedAt, body: n.body,
      }));
      todoItems = collectTodos(sources, { includeDone: showDoneTodos });
      todoCounts = countTodos(sources);
      listItemsBase = [];
      manualScope = null;
    } else if (view === 'trash') {
      const items: ListItem[] = q
        ? ((core.search(q, null, { includeTrash: true }) ?? []).filter((h) => h.deleted)).map((h) => rowFromHit(h))
        : core.listTrashNotes().map((n) => ({
            id: n.id, folder: n.folder, title: displayTitle(n),
            updatedAt: n.updatedAt, deletedAt: n.deletedAt,
            excerpt: n.body ? excerptOf(plainTextOf(n.body)) : '',
            deleted: true,
          }));
      listItemsBase = items;
      manualScope = null;
    } else {
      if (q) {
        const includeTrash = activeFolder === null;
        const hits: SearchHit[] = core.search(q, activeFolder, { includeTrash }) ?? [];
        listItemsBase = hits.map((h) => rowFromHit(h));
        manualScope = null;
      } else {
        const scope = activeFolder ?? SCOPE_ALL;
        manualScope = core.getNoteOrder(scope)?.length ? scope : null;
        listItemsBase = core.listNotesOrdered(scope).map((n) => ({
          id: n.id, folder: n.folder, title: displayTitle(n),
          updatedAt: n.updatedAt,
          excerpt: n.body ? excerptOf(plainTextOf(n.body)) : '',
          pinned: n.pinned,
          tags: n.tags,
        }));
      }
    }
    // 标签筛选只作用于“非搜索”的普通列表视图
    listItems = tagFilter && view === 'notes' && !q
      ? listItemsBase.filter((it) => (it.tags ?? []).some((t) => t.toLowerCase() === tagFilter!.toLowerCase()))
      : listItemsBase;
    // 标签条：始终按“全部笔记”统计（跨文件夹导航维度）
    allTags = view === 'notes' && !q
      ? countTags(core.listNotesOrdered(SCOPE_ALL).map((n) => ({ tags: n.tags })))
      : [];
    // 选中项去重/清理（列表刷新后仍在其中的保留）
    selectedIds = selectedIds.filter((id) => listItems.some((it) => it.id === id));
    if (selectedIds.length === 0 && selectionMode) { /* 空选可继续模式 */ }
    if (currentId) {
      const doc = core.getNote(currentId);
      if (doc && current) {
        current.updatedAt = doc.updatedAt;
        current.folder = doc.folder;
        current.pinned = doc.pinned;
        current.tags = doc.tags;
        current.deleted = doc.deleted ?? false;
        current.deletedAt = doc.deletedAt;
      } else if (!doc) {
        currentId = null;
        current = null;
      }
    }
  }

  function rowFromHit(h: SearchHit): ListItem {
    return {
      id: h.noteId, folder: h.folder, title: h.title.trim() === '' ? '无标题笔记' : h.title,
      updatedAt: h.updatedAt, snippet: h.snippet, where: h.where,
      hit: true, deleted: h.deleted ?? false,
    };
  }

  // ---------- 笔记打开 / 新建 / 回收站跳转 ----------
  async function openNote(id: string) {
    const same = currentId === id && current && !current.deleted;
    if (same) {
      // 当前笔记再点一次：若编辑区开着则保留现状；若已收起则重新展开（第三次点击）
      if (!editorOpen) { listOpen = true; editorOpen = true; }
      saveState = 'saved';
      return;
    }
    await flush();
    const doc = core.getNote(id);
    if (!doc) return;
    currentId = id;
    current = {
      id: doc.id, title: doc.title, body: doc.body, folder: doc.folder,
      updatedAt: doc.updatedAt, pinned: doc.pinned, tags: [...doc.tags],
      deleted: doc.deleted ?? false, deletedAt: doc.deletedAt,
    };
    saveState = 'saved';
    lastSavedAt = null;
    // 打开笔记 → 级联展开列表与编辑区（图4 → 图5）
    listOpen = true;
    editorOpen = true;
    if (view === 'trash') { /* 保持回收站视图 */ }
  }
  function openNoteItem(it: ListItem) {
    if (it.deleted && view !== 'trash') {
      // 全局搜索命中回收站 → 转入回收站查看
      view = 'trash';
      refresh();
    }
    void openNote(it.id);
  }
  function goView(v: 'notes' | 'trash' | 'todos') {
    closeCtx();
    selectionMode = false;
    selectedIds = [];
    view = v;
    query = '';
    todoHighlight = null;
    // 进入某视图：展开笔记列（图4），收起编辑区
    listOpen = true;
    editorOpen = false;
    refresh();
  }
  /** 侧栏 ↔ 笔记列 之间的手柄：图3 ⇄ 图4 */
  function toggleList() {
    closeCtx();
    if (listOpen) { listOpen = false; editorOpen = false; }
    else { listOpen = true; }
    refresh();
  }
  /** 笔记列 ↔ 编辑区 之间的手柄：图4 ⇄ 图5 */
  function toggleEditor() {
    if (!listOpen) return;
    editorOpen = !editorOpen;
  }
  async function newNote(targetFolder?: string) {
    await flush();
    const folder = targetFolder ?? activeFolder ?? folders[0] ?? '收件箱';
    const doc = await core.createNote({ folder, title: '', body: '' });
    currentId = doc.id;
    current = { id: doc.id, title: '', body: '', folder: doc.folder, updatedAt: doc.updatedAt };
    saveState = 'saved';
    // 新建即进入图5（列表+编辑展开）
    listOpen = true;
    editorOpen = true;
    refresh();
    requestAnimationFrame(() => editorRef?.focus());
  }

  // ---------- 回收站操作 ----------
  function trashNotesFlow(ids: string[]) {
    if (!ids.length) return;
    confirm = {
      title: '移入回收站',
      message: `确定把选中的 ${ids.length} 条笔记移入回收站吗？可随时还原。`,
      okLabel: '移入回收站',
      onOk: async () => {
        confirm = null;
        await core.deleteNotes(ids);
        clearSelection();
        refresh();
        const first = listItems[0];
        if (currentId && !core.getNote(currentId)) { currentId = null; current = null; }
        else if (first && currentId && !listItems.some((it) => it.id === currentId)) {
          await openNote(first.id);
        }
      },
    };
  }
  function trashCurrentFlow() {
    if (!current) return;
    trashNotesFlow([current.id]);
  }
  async function restoreSelected(ids: string[]) {
    for (const id of ids) await core.restoreNote(id);
    clearSelection();
    refresh();
  }
  function purgeSelectedFlow(ids: string[]) {
    confirm = {
      title: '彻底删除',
      message: `彻底删除选中的 ${ids.length} 条笔记？文件将从本地移除，无法恢复。`,
      okLabel: '彻底删除',
      danger: true,
      onOk: async () => {
        confirm = null;
        for (const id of ids) await core.purgeNote(id);
        clearSelection();
        refresh();
        if (currentId && !core.getNote(currentId)) { currentId = null; current = null; }
      },
    };
  }
  function purgeAllFlow() {
    confirm = {
      title: '清空回收站',
      message: `将彻底删除回收站中的全部内容（${trashCounts.notes} 条笔记${trashCounts.folders ? `、${trashCounts.folders} 个文件夹` : ''}），无法恢复。`,
      okLabel: '清空',
      danger: true,
      onOk: async () => {
        confirm = null;
        await core.purgeTrash();
        refresh();
      },
    };
  }
  function restoreCurrent() {
    if (!currentId) return;
    void restoreSelected([currentId]);
  }
  function purgeCurrentFlow() {
    if (!currentId) return;
    purgeSelectedFlow([currentId]);
  }

  // ---------- 多选 ----------
  function toggleSelection(id: string, e?: MouseEvent) {
    if (e?.shiftKey && selAnchor && selAnchor !== id) {
      const idxA = listItems.findIndex((it) => it.id === selAnchor);
      const idxB = listItems.findIndex((it) => it.id === id);
      if (idxA >= 0 && idxB >= 0) {
        const [lo, hi] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
        const range = listItems.slice(lo, hi + 1).map((it) => it.id);
        selectedIds = [...new Set([...selectedIds, ...range])];
        selAnchor = id;
        return;
      }
    }
    selAnchor = id;
    selectedIds = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    if (selectedIds.length > 0) selectionMode = true;
  }
  function clearSelection() {
    selectedIds = [];
    selAnchor = null;
    selectionMode = false;
  }
  function enterSelection() {
    selectionMode = true;
    selectedIds = [];
    selAnchor = null;
  }
  function isSelected(id: string) { return selectedIds.includes(id); }

  async function onRowClick(item: ListItem, e: MouseEvent) {
    if (suppressClick) { suppressClick = false; return; }
    if (selectionMode || e.ctrlKey || e.metaKey || e.shiftKey) {
      if (!selectionMode && (e.ctrlKey || e.metaKey)) enterSelection();
      toggleSelection(item.id, e);
      return;
    }
    // 再点当前已展开的笔记 → 收回编辑区（图5 → 图4）
    if (item.id === currentId && editorOpen) { editorOpen = false; return; }
    openNoteItem(item);
  }

  // ---------- 标签与置顶 ----------
  /** 标签筛选：点标签即筛选（幂等，不做 toggle，避免“点了没反应”）；用「清除标签」退出 */
  function setTagFilter(tag: string | null) {
    const next = tag ? normalizeTag(tag) : '';
    tagFilter = next || null;
    refresh();
  }

  /** 写回一条笔记的标签集合（立即落盘，不走正文去抖） */
  async function applyTags(id: string, tags: string[]) {
    const doc = await core.updateNote(id, { tags });
    if (!doc) { toast('标签保存失败：笔记不存在'); return; }
    if (current && current.id === id) current.tags = [...doc.tags];
    // 当前筛选的标签被整体移除 → 退出筛选，避免列表“空得莫名其妙”
    if (tagFilter && !hasTag(doc.tags, tagFilter)) tagFilter = null;
    refresh();
  }

  /** 提交标签输入框（空格/逗号/顿号可一次录入多个） */
  function commitTagDraft() {
    const id = current?.id;
    if (!id || current?.deleted) { tagDraft = ''; return; }
    const parsed = parseTagInput(tagDraft);
    tagDraft = '';
    if (parsed.length === 0) return;
    void applyTags(id, mergeTags(current?.tags ?? [], parsed));
  }

  function addTagToCurrent(tag: string) {
    const id = current?.id;
    if (!id || current?.deleted) return;
    const next = mergeTags(current?.tags ?? [], [tag]);
    if (next.length === (current?.tags ?? []).length) return;
    void applyTags(id, next);
  }

  function removeTagFromCurrent(tag: string) {
    const id = current?.id;
    if (!id || current?.deleted) return;
    void applyTags(id, removeTag(current?.tags ?? [], tag));
  }

  /** 置顶/取消置顶（单条；也用于右键菜单） */
  async function setPinned(id: string, pinned: boolean) {
    const doc = await core.updateNote(id, { pinned });
    if (!doc) { toast('置顶失败：笔记不存在'); return; }
    if (current && current.id === id) current.pinned = doc.pinned;
    refresh();
    toast(doc.pinned ? '已置顶' : '已取消置顶');
  }

  function togglePinned(id: string) {
    const doc = core.getNote(id);
    if (!doc) return;
    void setPinned(id, !doc.pinned);
  }

  /** 批量置顶/取消置顶（多选模式） */
  async function setPinnedSelected(pinned: boolean) {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    for (const id of ids) await core.updateNote(id, { pinned });
    if (current && ids.includes(current.id)) current.pinned = pinned;
    refresh();
    toast(pinned ? `已置顶 ${ids.length} 条` : `已取消置顶 ${ids.length} 条`);
  }

  // ---------- 右键菜单 ----------
  function showCtx(x: number, y: number, items: CtxItem[]) {
    ctx = { x, y, rows: items };
  }
  function onFolderCtx(e: MouseEvent, folder: string) {
    e.preventDefault();
    e.stopPropagation();
    const items: CtxItem[] = [
      { id: 'new-in', label: '在「' + folder + '」中新建笔记', icon: '📝', onClick: () => void newNote(folder) },
      { id: 'new-folder', label: '新建文件夹', icon: '📁', onClick: newFolderFlow },
    ];
    if (folder !== '收件箱') {
      items.push({ type: 'sep' } as never);
      items.push(
        { id: 'rename', label: '重命名', icon: '✏️', onClick: () => startRenameFolder(folder) },
        { id: 'del', label: '删除（移入回收站）', icon: '🗑️', danger: true, onClick: () => deleteFolderFlow(folder) }
      );
    }
    showCtx(e.clientX, e.clientY, items);
  }
  function onBlankCtx(e: MouseEvent) {
    e.preventDefault();
    showCtx(e.clientX, e.clientY, [
      { id: 'new-note', label: '新建笔记', icon: '📝', onClick: () => void newNote() },
      { id: 'new-folder', label: '新建文件夹', icon: '📁', onClick: newFolderFlow },
    ]);
  }
  function onNoteRowCtx(e: MouseEvent, item: ListItem) {
    e.preventDefault();
    e.stopPropagation();
    const isTrash = view === 'trash' || item.deleted;
    const items: CtxItem[] = isTrash
      ? [
          { id: 'restore', label: '还原', icon: '↩️', onClick: () => { void restoreSelected([item.id]); } },
          { id: 'purge', label: '彻底删除', icon: '🗑️', danger: true, onClick: () => purgeSelectedFlow([item.id]) },
        ]
      : [
          { id: 'open', label: '打开', icon: '📖', onClick: () => { if (!selectionMode) void openNote(item.id); } },
          {
            id: 'pin',
            label: item.pinned ? '取消置顶' : '置顶',
            icon: '📌',
            onClick: () => {
              const ids = selectionMode && selectedIds.includes(item.id) ? [...selectedIds] : [item.id];
              void (async () => {
                for (const id of ids) await core.updateNote(id, { pinned: !item.pinned });
                if (current && ids.includes(current.id)) current.pinned = !item.pinned;
                refresh();
                toast(item.pinned ? '已取消置顶' : '已置顶');
              })();
            },
          },
          { id: 'del', label: '移入回收站', icon: '🗑️', danger: true, onClick: () => trashNotesFlow([item.id]) },
        ];
    showCtx(e.clientX, e.clientY, items);
  }
  function onTrashFolderCtx(e: MouseEvent, name: string) {
    e.preventDefault();
    e.stopPropagation();
    showCtx(e.clientX, e.clientY, [
      { id: 'restore', label: '还原文件夹', icon: '↩️', onClick: () => { void core.restoreFolder(name).then((r) => { if (!r.ok) toast(r.reason ?? ''); refresh(); }); } },
      { id: 'purge', label: '彻底删除（含其中笔记）', icon: '🗑️', danger: true, onClick: () => purgeTrashFolderFlow(name) },
    ]);
  }

  // ---------- 删除（当前笔记/文件夹） ----------
  function deleteFolderFlow(name: string) {
    confirm = {
      title: '删除文件夹',
      message: `把文件夹「${name}」及其中的笔记移入回收站？（保留结构与元数据，可整组还原）`,
      okLabel: '移入回收站',
      onOk: async () => {
        confirm = null;
        const r = await core.deleteFolder(name);
        if (!r.ok) { toast(r.reason ?? '删除失败'); return; }
        if (activeFolder === name) activeFolder = null;
        refresh();
      },
    };
  }
  function purgeTrashFolderFlow(name: string) {
    confirm = {
      title: '彻底删除文件夹',
      message: `彻底删除回收站中的「${name}」及其全部笔记？无法恢复。`,
      okLabel: '彻底删除',
      danger: true,
      onOk: async () => {
        confirm = null;
        await core.purgeFolder(name);
        refresh();
      },
    };
  }

  // ---------- 编辑输入 ----------
  function onTitleInput(e: Event) {
    if (!current || current.deleted) return;
    current.title = (e.target as HTMLInputElement).value;
    markDirty();
  }
  function onBodyInput(e: Event) {
    if (!current || current.deleted) return;
    current.body = (e.target as HTMLTextAreaElement).value;
    markDirty();
  }
  async function onFolderChange(v: string) {
    if (!current || current.deleted) return;
    await flush();
    if (current.folder === v) return;
    const doc = await core.updateNote(current.id, { folder: v });
    if (doc) { current.folder = doc.folder; refresh(); }
  }
  async function onPreviewClick(e: MouseEvent) {
    const el = e.target as HTMLElement;
    const box = el.closest?.('input.task-check') as HTMLInputElement | null;
    if (!box || !current || current.deleted) return;
    const offset = Number(box.dataset.offset);
    if (!Number.isInteger(offset)) return;
    await flush();
    const ok = await core.toggleTask(current.id, offset);
    if (ok) {
      const doc = core.getNote(current.id);
      if (doc) { current.body = doc.body; current.updatedAt = doc.updatedAt; }
      saveState = 'saved';
      refresh();
    }
  }

  // ---------- 待办聚合 ----------

  /** 切换“显示已完成”（重算聚合结果） */
  function toggleShowDoneTodos() {
    showDoneTodos = !showDoneTodos;
    refresh();
  }

  /** 在聚合视图里勾选/取消勾选：回写源文，然后重算（未完成项勾掉后会从清单消失） */
  async function toggleTodo(item: TodoItem) {
    const ok = await core.toggleTask(item.noteId, item.offset);
    if (!ok) { toast('勾选失败：任务行可能已被修改'); refresh(); return; }
    if (current && current.id === item.noteId) {
      const doc = core.getNote(item.noteId);
      if (doc) { current.body = doc.body; current.updatedAt = doc.updatedAt; }
      saveState = 'saved';
    }
    refresh();
  }

  /** 从聚合视图跳到任务所在笔记，并在编辑器里定位/短暂高亮该行 */
  async function openTodoSource(item: TodoItem) {
    await openNote(item.noteId);
    todoHighlight = { id: item.noteId, offset: item.offset };
    if (todoHighlightTimer) clearTimeout(todoHighlightTimer);
    todoHighlightTimer = setTimeout(() => { todoHighlight = null; }, 1800);
    // 等编辑区渲染出来再滚动定位（文本域按比例估算行位置）
    requestAnimationFrame(() => {
      const ta = editorRef;
      const body = current?.body ?? '';
      if (!ta || !body) return;
      const line = body.slice(0, item.offset).split('\n').length - 1;
      const totalLines = body.split('\n').length;
      const ratio = totalLines > 1 ? line / (totalLines - 1) : 0;
      ta.scrollTop = Math.max(0, ratio * ta.scrollHeight - ta.clientHeight / 2);
      try { ta.focus({ preventScroll: true }); } catch { /* 忽略聚焦失败 */ }
    });
  }

  // ---------- 文件夹 ----------
  function newFolderFlow() {
    prompt = {
      title: '新建文件夹',
      placeholder: '文件夹名称',
      value: '',
      onOk: async (v) => {
        const name = v.trim();
        if (!name) { toast('文件夹名不能为空'); return; }
        const r = await core.createFolder(name);
        if (!r.ok) { toast(r.reason ?? '创建失败'); return; }
        prompt = null;
        activeFolder = name;
        refresh();
      },
    };
  }
  function startRenameFolder(name: string) {
    closeCtx();
    renamingFolder = name;
    renameValue = name;
    requestAnimationFrame(() => renameInput?.focus());
  }
  async function commitRenameFolder() {
    const from = renamingFolder;
    renamingFolder = null;
    const to = renameValue.trim();
    if (!from || to === from) return;
    const r = await core.renameFolder(from, to);
    if (!r.ok) { toast(r.reason ?? '重命名失败'); refresh(); return; }
    // 正在浏览的就是这个文件夹时，activeFolder 仍指向旧名 → 列表会显示成“空文件夹”；
    // 跟随改名并保持浏览状态（列表/编辑区不因为改个名字被收起）。
    if (activeFolder === from) activeFolder = to;
    refresh();
  }

  /** 当前浏览的文件夹名是否已经不存在（例如在其它窗口被重命名/删除） */
  function activeFolderMissing(): boolean {
    return activeFolder !== null && !folders.includes(activeFolder);
  }
  function backToAllNotes() {
    activeFolder = null;
    view = 'notes';
    tagFilter = null;
    refresh();
  }
  function toggleFolder(folder: string) {
    closeCtx();
    if (view !== 'notes') view = 'notes';
    // 再点同一个已展开的文件夹 → 收回笔记列（图4 → 图3）
    if (listOpen && activeFolder === folder) {
      listOpen = false;
      editorOpen = false;
    } else {
      activeFolder = folder;
      view = 'notes';
      listOpen = true;      // 点文件夹 → 滑出笔记列（图4）
      editorOpen = false;   // 切换文件夹收起编辑区（从图3/图4重新开始）
      query = '';
      tagFilter = null;     // 换文件夹时清掉标签筛选，避免“空列表”困惑
    }
    refresh();
  }
  function selectAllNotes() {
    // “全部笔记”：打开全部视图并展开笔记列（图4）；不关闭（作视图锚点）
    closeCtx();
    activeFolder = null;
    view = 'notes';
    query = '';
    listOpen = true;
    editorOpen = false;
    refresh();
  }

  // ---------- 排序与拖放（文件夹拖拽 / 笔记移动与手排） ----------
  /** folderDropIdx = 移除被拖项之后的“最终插入下标”；仅当不变时拖放为 no-op */
  async function commitFolderDrop(fromIdx: number, toIdx: number) {
    dragFolderIdx = null;
    folderDropIdx = null;
    overFolderName = null;
    if (toIdx < 0 || toIdx > folders.length) return;
    if (toIdx === fromIdx) return; // 拖回原位
    const next = [...folders];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    const r = await core.reorderFolders(next);
    if (!r.ok) toast(r.reason ?? '排序失败');
    refresh();
  }
  /** 按插入下标把笔记写入手排（scope = 文件夹名 或 'all'）；未手排的作用域跳过 */
  async function commitReorderWith(scope: string, ids: string[], insertIdx: number) {
    const currentIds = listItems.map((it) => it.id);
    // 置顶是独立分区：拖动后若落点所属分区与拖动项不同，直接忽略并提示，
    // 否则手排顺序会和置顶分区互相打架（列表看起来“没反应”或跳位）。
    const pinnedOf = new Map(listItems.map((it) => [it.id, !!it.pinned]));
    const draggedPinned = pinnedOf.get(ids[0]) ?? false;
    if (listItems.some((it) => !!it.pinned)) {
      const targetBefore = listItems[insertIdx - 1];
      const targetAfter = listItems[insertIdx];
      const targetPinned = targetBefore ? !!targetBefore.pinned : (targetAfter ? !!targetAfter.pinned : draggedPinned);
      if (targetPinned !== draggedPinned) {
        clearDragUI();
        toast(draggedPinned ? '置顶笔记固定在最前，取消置顶后才能拖到普通区' : '拖动到置顶区请先用右键「置顶」');
        return;
      }
    }
    let insertPos = insertIdx;
    const rest: string[] = [];
    for (let i = 0; i < currentIds.length; i++) {
      const id = currentIds[i];
      if (ids.includes(id)) { if (i < insertIdx) insertPos -= 1; continue; }
      rest.push(id);
    }
    const toInsert = ids.filter((id) => currentIds.includes(id));
    if (toInsert.length === 0) return;
    rest.splice(Math.max(0, Math.min(insertPos, rest.length)), 0, ...toInsert);
    await core.setNoteOrder(scope, rest);
    refresh();
  }

  async function moveNotesToFolder(ids: string[], folder: string) {
    if (!folder) return;
    for (const id of ids) {
      const doc = core.getNote(id);
      if (doc && doc.folder !== folder) await core.updateNote(id, { folder });
    }
    if (current && ids.includes(current.id)) current.folder = folder;
    clearDragUI();
    refresh();
  }
  async function trashNotesDrop(ids: string[]) {
    await core.deleteNotes(ids);
    if (currentId && ids.includes(currentId)) { currentId = null; current = null; }
    clearDragUI();
    refresh();
    toast(`已将 ${ids.length} 条笔记移入回收站`);
  }

  // ---------- 指针拖拽实现（鼠标按下 → 移动 → 松开） ----------
  let dragBound = false;
  function clearDragUI() {
    draggingNoteIds = null;
    overFolderName = null;
    overTrash = false;
    dropLineIdx = null;
    dragFolderIdx = null;
    folderDropIdx = null;
    document.body.classList.remove('is-dragging');
  }
  function releasePointer() {
    if (dragBound) {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      dragBound = false;
    }
  }
  function bindPointerListeners() {
    if (!dragBound) {
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);
      dragBound = true;
    }
  }
  function beginPotentialNoteDrag(e: PointerEvent, ids: string[]) {
    if (e.button !== 0) return;
    if (view === 'trash') return;
    if ((e.target as HTMLElement).closest('.row-check, input, select, .ctx-menu')) return;
    ptDown = { kind: 'note', ids: [...ids], fromIdx: null, x: e.clientX, y: e.clientY, active: false };
    bindPointerListeners();
  }
  function beginPotentialFolderDrag(e: PointerEvent, fi: number) {
    if (e.button !== 0) return;
    ptDown = { kind: 'folder', ids: [], fromIdx: fi, x: e.clientX, y: e.clientY, active: false };
    bindPointerListeners();
  }
  function onPointerMove(e: PointerEvent) {
    if (!ptDown) return;
    if (!ptDown.active) {
      const dx = Math.abs(e.clientX - ptDown.x);
      const dy = Math.abs(e.clientY - ptDown.y);
      if (Math.max(dx, dy) < 5) return; // 拖拽阈值
      ptDown.active = true;
      suppressClick = true; // 拖拽后不再当作点击
      document.body.classList.add('is-dragging');
      if (ptDown.kind === 'note') draggingNoteIds = [...ptDown.ids];
      else dragFolderIdx = ptDown.fromIdx;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    overTrash = !!el?.closest?.('.trash-entry');
    if (ptDown.kind === 'note') {
      const folderMain = el?.closest?.('.folder-main') as HTMLElement | null;
      if (folderMain) {
        overFolderName = folderMain.dataset.folder ?? null;
        dropLineIdx = null;
      } else if (el?.closest?.('.note-list')) {
        overFolderName = null;
        dropLineIdx = nearestRowIndex('.note-list .note-row', e.clientY);
      } else {
        overFolderName = null;
        dropLineIdx = null;
      }
    } else {
      folderDropIdx = el?.closest?.('#folder-list, .nav-scroll')
        ? nearestRowIndex('.folder-item .folder-main', e.clientY)
        : null;
    }
  }
  function onPointerUp(e: PointerEvent) {
    if (!ptDown) return;
    const p = ptDown;
    const wasDrag = p.active;
    const targetEl = wasDrag ? (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null) : null;
    const folderToIdx = folderDropIdx;   // 在 clear 前取值
    const listDropIdx = dropLineIdx;
    const folderFromIdx = dragFolderIdx;
    releasePointer();
    const kind = p.kind;
    const ids = [...p.ids];
    const fromIdx = p.fromIdx;
    ptDown = null;
    if (!wasDrag) return; // 轻点：交给 click 处理
    clearDragUI();
    if (kind === 'folder') {
      if (folderFromIdx !== null && folderToIdx !== null) void commitFolderDrop(folderFromIdx, folderToIdx);
      else if (folderFromIdx !== null) void commitFolderDrop(folderFromIdx, folderFromIdx);
      return;
    }
    // note：优先目标文件夹 / 回收站，否则列表内手排
    const folderMain = targetEl?.closest?.('.folder-main') as HTMLElement | null;
    if (folderMain && ids.length) { void moveNotesToFolder(ids, folderMain.dataset.folder ?? ''); return; }
    if (targetEl?.closest?.('.trash-entry') && ids.length) { void trashNotesDrop(ids); return; }
    const scope = currentScope;
    if (scope && ids.length && listDropIdx !== null) {
      void commitReorderWith(scope, ids, listDropIdx);
    } else {
      refresh();
    }
  }
  function nearestRowIndex(selector: string, y: number): number | null {
    const rows = [...document.querySelectorAll(selector)];
    if (rows.length === 0) return null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!.getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return rows.length;
  }

  // ---------- 搜索 / 排序切换 ----------
  function onSearchInput(v: string) {
    query = v;
    closeCtx();
    refresh();
  }
  function resetToTimeOrder() {
    if (!currentScope) return;
    void core.setNoteOrder(currentScope, null).then(() => { refresh(); toast('已恢复“按更新时间排序”'); });
  }

  // ---------- 快捷键 ----------
  // ---------- 窗口随面板开合自适应（桌面 Tauri；Web 预览下为 no-op） ----------
  const SIDEBAR_W = 224;
  const LIST_W = 300;
  const EDITOR_W = 680;
  const SEAM_W = 8;

  function isTauri() {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }
  function computeWidth(): number {
    let w = SIDEBAR_W + SEAM_W; // 侧栏 + 手柄A
    if (listOpen) w += SEAM_W + LIST_W; // 笔记列 + 手柄B
    if (editorOpen) w += SEAM_W + EDITOR_W;
    return w;
  }
  async function applyWindowWidth(w: number) {
    if (!core || !isTauri()) return;
    try {
      // 用 CSS 像素（LogicalSize）设置宽度；高度保持当前逻辑像素，任意 DPI 下都正确
      await getCurrentWindow().setSize(new LogicalSize(w, window.innerHeight));
    } catch { /* 忽略（如窗口被系统限制） */ }
  }
  // 面板开合 → 窗口宽度随之变化。
  // 关键：effect 里先调用 computeWidth()（读取 listOpen/editorOpen），确保 Svelte 建立响应式依赖，
  // 否则首次运行时若 core 未就绪提前返回，后续开合就不会再触发缩放。
  $effect(() => {
    const w = computeWidth();
    void applyWindowWidth(w);
  });

  // 侧边吸附：按设置决定是否启用；onlySidebar=true 时仅在“图3 侧栏态”生效
  $effect(() => {
    const sidebarOnly = settings.dock.onlySidebar;
    const layoutOk = sidebarOnly ? (!listOpen && !editorOpen) : true;
    const allow = ready && settings.dock.enabled && layoutOk;
    if (!dock || !core) return;
    if (allow) dock.activate();
    else dock.deactivate();
  });

  // 面板状态记忆（设置开启时）
  $effect(() => {
    if (!ready || !settings.general.rememberPanels) return;
    const snapshotPanels = { listOpen, editorOpen, folder: activeFolder };
    if (panelsSaveTimer) clearTimeout(panelsSaveTimer);
    panelsSaveTimer = setTimeout(() => { panelsSaveTimer = undefined; void persistPanels(snapshotPanels); }, 400);
  });

  async function persistPanels(panels: NonNullable<AppSettings['lastPanels']>): Promise<void> {
    if (!settings.general.rememberPanels) return;
    if (
      settings.lastPanels &&
      settings.lastPanels.listOpen === panels.listOpen &&
      settings.lastPanels.editorOpen === panels.editorOpen &&
      settings.lastPanels.folder === panels.folder
    ) {
      return;
    }
    settings.lastPanels = panels;
    await saveSettings($state.snapshot(settings) as AppSettings);
  }

  /** 打开独立设置窗口（桌面）；Web 预览用浏览器新窗口 */
  async function openSettingsWindow(): Promise<void> {
    if (isTauri()) {
      try {
        let w = await WebviewWindow.getByLabel('settings');
        if (!w) {
          // 窗口已被销毁（例如被系统关闭）时按需重建
          w = new WebviewWindow('settings', {
            url: 'settings.html',
            title: '设置 - NoteApp',
            width: 820,
            height: 620,
            minWidth: 680,
            minHeight: 480,
            resizable: true,
            center: true,
          });
          await new Promise<void>((resolve) => {
            void w!.once('tauri://created', () => resolve());
            void w!.once('tauri://error', () => resolve());
          });
        }
        await w.show();
        await w.setFocus();
        return;
      } catch { /* 忽略：创建或显示失败时保持静默 */ }
      return;
    }
    window.open('/settings.html', 'noteapp-settings', 'width=860,height=640');
  }

  /** 启动布局：按设置停在图3/图4/图5，或沿用上次面板状态 */
  function applyStartLayout(cfg: AppSettings): void {
    const remembered = cfg.general.rememberPanels ? cfg.lastPanels : undefined;
    if (remembered) {
      listOpen = remembered.listOpen;
      editorOpen = remembered.editorOpen;
      activeFolder = remembered.folder;
    } else if (cfg.general.startLayout === 'fig4') {
      listOpen = true; editorOpen = false;
    } else if (cfg.general.startLayout === 'fig5') {
      listOpen = true; editorOpen = true;
    } else {
      listOpen = false; editorOpen = false;
    }
    refresh();
    if (editorOpen && !currentId && listItems[0]) void openNote(listItems[0].id);
  }

  // 动作运行体（与设置窗口的键位目录一一对应）
  const ACTION_RUN: Record<string, () => void> = {
    'new-note': () => { if (ready) void newNote(); },
    'focus-search': () => { if (ready) searchEl?.focus(); },
    'save-now': () => { if (ready) void flush(); },
    'open-settings': () => { void openSettingsWindow(); },
    'help': () => { helpOpen = !helpOpen; },
  };

  /** 依据设置中的键位（含自定义覆盖/禁用）重新注册全部动作 */
  function registerActions(cfg: AppSettings) {
    const effective = effectiveShortcuts(cfg.shortcuts);
    const next = new ActionRegistry();
    for (const meta of ACTION_CATALOG) {
      const run = ACTION_RUN[meta.id];
      if (!run) continue;
      const shortcut = effective[meta.id] ?? undefined;
      next.register({ id: meta.id, label: meta.label, ...(shortcut ? { shortcut } : {}), run });
    }
    registry = next;
  }
  function onGlobalKey(e: KeyboardEvent) {
    if (ctx) {
      // 菜单打开时 Esc 由组件处理（capture），这里放行其它全局键
      if (e.key !== 'Escape' && !e.key.startsWith('Arrow') && !e.key.startsWith('Enter')) { /* 允许继续 */ }
    }
    if (e.key === 'Enter' && prompt) {
      const value = prompt.value.trim();
      prompt.onOk(value);
      return;
    }
    if (e.key === 'Escape') {
      if (ctx) { ctx = null; return; }
      if (helpOpen) { helpOpen = false; return; }
      if (prompt) { prompt = null; return; }
      if (confirm) { confirm = null; return; }
      if (renamingFolder) { renamingFolder = null; return; }
      if (selectionMode && selectedIds.length === 0) { selectionMode = false; return; }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && selectionMode) {
      e.preventDefault();
      selectedIds = listItems.map((it) => it.id);
      return;
    }
    const action = registry.match(e);
    if (!action) return;
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const mods = action.shortcut;
    if (typing && !(mods?.ctrl || mods?.alt || mods?.meta)) return;
    e.preventDefault();
    action.run();
  }

  // ---------- 其它 ----------
  let editorRef: HTMLTextAreaElement | undefined = $state();
  let renameInput: HTMLInputElement | undefined = $state();

  function previewAction(node: HTMLElement) {
    const onClick = (e: Event) => { void onPreviewClick(e as MouseEvent); };
    node.addEventListener('click', onClick);
    return { destroy() { node.removeEventListener('click', onClick); } };
  }

  function visibleTitle(item: ListItem) {
    return item.title || '无标题笔记';
  }

  onMount(() => {
    window.addEventListener('keydown', onGlobalKey);
    const flushTimer = () => { if (saveState !== 'idle') void flush(); };
    window.addEventListener('beforeunload', flushTimer);
    window.addEventListener('blur', flushTimer);

    void (async () => {
      const loaded = await loadSettings();
      settings = loaded;
      themeFollower.update(loaded.general.theme);
      registerActions(loaded);
      core = await createCore();
      core.on(() => refresh());
      ready = true;
      refresh();
      applyStartLayout(loaded);
      void applyWindowWidth(computeWidth());
      if (isTauri()) {
        dock = new SideDock();
        dock.setConfig({ ...loaded.dock });
        const layoutOk = loaded.dock.onlySidebar ? (!listOpen && !editorOpen) : true;
        if (loaded.dock.enabled && layoutOk) dock.activate();
      }
      unsubSettings = subscribeSettings((next) => {
        settings = next;
        themeFollower.update(next.general.theme);
        registerActions(next);
        dock?.setConfig({ ...next.dock });
      });
    })();
    return () => {
      window.removeEventListener('keydown', onGlobalKey);
      window.removeEventListener('beforeunload', flushTimer);
      window.removeEventListener('blur', flushTimer);
      releasePointer();
      unsubSettings?.();
      themeFollower.stop();
      if (todoHighlightTimer) clearTimeout(todoHighlightTimer);
      dock?.destroy();
      if (panelsSaveTimer) clearTimeout(panelsSaveTimer);
      if (saveTimer) clearTimeout(saveTimer);
    };
  });
</script>

{#if !ready}
  <div class="boot">正在打开本地笔记…</div>
{:else}
  <main class="app-shell">
    <!-- 左：文件夹 / 导航（图3 常态仅此栏，面板逐级滑出） -->
    <aside
      class="sidebar"
      oncontextmenu={onBlankCtx}
    >
      <div class="sb-brand">
        <span class="logo">N</span>
        <div class="sb-brand-text"><strong>NoteApp</strong><small>本地 Markdown 笔记</small></div>
      </div>

      <button class="btn-primary" onclick={() => void newNote()}>＋ 新建笔记</button>

      <div class="nav-scroll">
        <p class="nav-label">笔记</p>
        <button
          class="nav-item" class:active={view === 'notes' && activeFolder === null && !query}
          onclick={selectAllNotes}
        >
          <span class="nav-ico">🗂️</span>全部笔记
          <span class="nav-count">{totalNotes}</span>
        </button>

        <div class="nav-label-row">
          <p class="nav-label">文件夹</p>
          <button class="btn-icon" title="新建文件夹" onclick={newFolderFlow}>＋</button>
        </div>
        <div id="folder-list">
          {#each folders as folder, fi (folder)}
            {#if renamingFolder === folder}
              <div class="folder-rename">
                <input
                  bind:this={renameInput}
                  value={renameValue}
                  oninput={(e) => (renameValue = (e.target as HTMLInputElement).value)}
                  onkeydown={(e) => {
                    if (e.key === 'Enter') void commitRenameFolder();
                    if (e.key === 'Escape') renamingFolder = null;
                  }}
                  onblur={() => void commitRenameFolder()}
                  oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                />
              </div>
            {:else}
              <div
                class="nav-item folder-item"
                class:active={view === 'notes' && activeFolder === folder && !query}
                class:drop-target={overFolderName === folder}
                class:drop-line-top={folderDropIdx === fi}
                class:drop-line-bottom={folderDropIdx === fi + 1}
                oncontextmenu={(e) => onFolderCtx(e, folder)}
                role="button"
                tabindex="-1"
              >
                <span class="folder-arrow" class:open={view === 'notes' && activeFolder === folder}>▶</span>
                <button
                  class="folder-main grab"
                  data-folder={folder}
                  title="拖拽可调整文件夹顺序；也可把笔记拖到这里移动"
                  onclick={() => toggleFolder(folder)}
                  ondblclick={(e) => { e.stopPropagation(); startRenameFolder(folder); }}
                  onpointerdown={(e) => beginPotentialFolderDrag(e, fi)}
                >
                  <span class="nav-ico">📁</span><span class="folder-name">{folder}</span>
                  <span class="nav-count fcount">{counts[folder] ?? 0}</span>
                  {#if folder !== '收件箱'}
                    <span
                      class="fdel" role="button" tabindex="-1" title="删除文件夹（移入回收站）"
                      onclick={(e) => { e.stopPropagation(); deleteFolderFlow(folder); }}
                    >✕</span>
                  {/if}
                </button>
              </div>
            {/if}
          {/each}
        </div>

        <!-- 回收站入口（常驻底部独立区域） -->
        <p class="nav-label trash-label">其它</p>
        <button
          class="nav-item todo-entry"
          class:active={view === 'todos'}
          onclick={() => goView('todos')}
          title="汇总所有笔记里未完成的待办"
        >
          <span class="nav-ico">☑️</span>待办
          <span class="nav-count">{todoCounts.open}</span>
        </button>
        <button
          class="nav-item trash-entry"
          class:active={view === 'trash'}
          class:drop={overTrash}
          onclick={() => goView('trash')}
          title="拖拽笔记到这里可移入回收站"
        >
          <span class="nav-ico">🗑️</span>回收站
          <span class="nav-count">{trashCounts.notes + trashCounts.folders}</span>
        </button>
      </div>

      <div class="sb-foot">
        <button class="btn-ghost" onclick={() => void openSettingsWindow()}>⚙️ 设置</button>
        <button class="btn-ghost" onclick={() => (helpOpen = true)}>⌨️ 快捷键</button>
        <span class="sb-storage">存储：{core ? (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? '本机文件' : '本机（IndexedDB）') : ''}</span>
      </div>
    </aside>

    <!-- 手柄：侧栏 ⇄ 笔记列（整条竖线可点击展开/收回，视觉为细条+小箭头） -->
    <button
      class="seam seam-a"
      title="展开 / 收回笔记列"
      aria-label={listOpen ? '收回笔记列' : '展开笔记列'}
      onclick={toggleList}
    >
      <span class="seam-arrow">{listOpen ? '◀' : '▶'}</span>
    </button>

    <!-- 中：搜索 + 笔记列表（图4） -->
    <section class="list-pane" class:open={listOpen}>
      <div class="list-head">
        <h2>{view === 'todos' ? '待办' : view === 'trash' ? '回收站' : tagFilter ? `#${tagFilterLabel}` : (activeFolder ?? '全部笔记')}</h2>
        <div class="head-actions">
          <span class="list-sub" id="list-sub">
            {#if query}
              {view === 'todos' ? `${visibleTodos.length} 条匹配` : '搜索结果'}
            {:else if view === 'todos'}
              {todoCounts.open} 条未完成{todoCounts.done > 0 ? ` · ${todoCounts.done} 条已完成` : ''}
            {:else if view === 'trash'}
              {trashCounts.notes + trashCounts.folders} 项
            {:else if tagFilter}
              标签筛选{hasPinnedInList ? ` · ${pinnedCount} 条置顶` : ''}
            {:else if manualScope}
              手动排序{hasPinnedInList ? ` · ${pinnedCount} 条置顶` : ''}
            {:else}
              按更新时间排序{hasPinnedInList ? ` · ${pinnedCount} 条置顶` : ''}
            {/if}
          </span>
          {#if view === 'todos' && todoCounts.done > 0}
            <button class="chip-btn" id="todo-show-done" onclick={toggleShowDoneTodos}>
              {showDoneTodos ? '隐藏已完成' : '显示已完成'}
            </button>
          {/if}
          {#if tagFilter}
            <button class="chip-btn" id="tag-clear" title="清除标签筛选" onclick={() => setTagFilter(null)}>清除标签</button>
          {/if}
          {#if currentScope && manualScope}
            <button class="chip-btn" title="恢复按更新时间排序" onclick={resetToTimeOrder}>恢复时间序</button>
          {/if}
          {#if !query && listItems.length > 0}
            <button class="chip-btn" onclick={selectionMode ? clearSelection : enterSelection}>
              {selectionMode ? '取消选择' : '选择'}
            </button>
          {/if}
          {#if view === 'trash' && (trashCounts.notes || trashCounts.folders)}
            <button class="chip-btn danger" onclick={purgeAllFlow}>清空回收站</button>
          {/if}
        </div>
      </div>

      <!-- 兜底：当前文件夹名已不存在（例如在设置/其它窗口被改名或删除）→ 给出出口而不是空列表 -->
      {#if view === 'notes' && !query && activeFolderMissing()}
        <div class="trash-banner" id="folder-missing">
          <span>文件夹「{activeFolder}」已不存在（可能被重命名或删除）。</span>
          <button class="btn-primary small" onclick={backToAllNotes}>查看全部笔记</button>
        </div>
      {/if}

      <!-- 标签筛选条：列出当前作用域内的标签与条数，点击即筛选（再点取消） -->
      {#if view === 'notes' && !query && tagChips.length > 0}
        <div class="tagbar" id="tagbar">
          {#each tagChips as t (t.tag)}
            <button
              class="tag-chip" class:active={tagFilter?.toLowerCase() === t.tag.toLowerCase()}
              data-tag={t.tag}
              title={`筛选标签 #${t.tag}（${t.count} 条）`}
              onclick={() => setTagFilter(t.tag)}
            >
              #{t.tag}<span class="tag-count">{t.count}</span>
            </button>
          {/each}
        </div>
      {/if}
      <div class="searchbox">
        <span class="search-ico">🔍</span>
        <input
          bind:this={searchEl}
          type="text"
          placeholder={view === 'trash' ? '在回收站中搜索…（Ctrl+K）' : '搜索标题与正文…（Ctrl+K）'}
          value={query}
          oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
          autocomplete="off"
          spellcheck="false"
        />
        {#if query}
          <button class="search-clear" title="清空搜索" onclick={() => onSearchInput('')}>✕</button>
        {/if}
      </div>

      <!-- 多选操作条 -->
      {#if selectionMode}
        <div class="selbar">
          <span class="sel-count">已选 {selectedIds.length} 项</span>
          <button class="btn-ghost small" onclick={() => (selectedIds = listItems.map((it) => it.id))}>全选</button>
          {#if view === 'trash'}
            <button class="btn-primary small" disabled={selectedIds.length === 0} onclick={() => { const ids = [...selectedIds]; void restoreSelected(ids); }}>还原</button>
            <button class="btn-danger small" disabled={selectedIds.length === 0} onclick={() => { const ids = [...selectedIds]; purgeSelectedFlow(ids); }}>彻底删除</button>
          {:else}
            <button class="btn-danger small" disabled={selectedIds.length === 0} onclick={() => { const ids = [...selectedIds]; trashNotesFlow(ids); }}>移入回收站</button>
            <button class="btn-ghost small" disabled={selectedIds.length === 0} onclick={() => void setPinnedSelected(true)}>置顶</button>
            <button class="btn-ghost small" disabled={selectedIds.length === 0} onclick={() => void setPinnedSelected(false)}>取消置顶</button>
          {/if}
          <span class="spacer"></span>
          <button class="btn-ghost small" onclick={clearSelection}>取消</button>
        </div>
      {/if}

      <div class="note-list" oncontextmenu={(e) => { if ((e.target as HTMLElement).closest('.note-row') || (e.target as HTMLElement).closest('.trash-folder')) return; e.preventDefault(); onBlankCtx(e); }}>
        {#if view === 'trash' && !query && trashFolders.length > 0}
          <div class="trash-folders">
            <p class="trash-section-label">已删除文件夹</p>
            {#each trashFolders as tf (tf.name)}
              <div
                class="trash-folder"
                oncontextmenu={(e) => onTrashFolderCtx(e, tf.name)}
              >
                <span class="nav-ico">📁</span>
                <span class="folder-name">{tf.name}</span>
                <span class="nav-count">{tf.noteCount} 条</span>
              </div>
            {/each}
          </div>
        {/if}

        {#if view === 'todos'}
          <!-- 待办聚合清单：勾选即回写源文；点任务文本跳回原笔记并定位该行 -->
          {#if visibleTodos.length === 0}
            <div class="list-empty">
              {query ? '没有匹配的待办' : showDoneTodos ? '还没有任何待办（在笔记里写 - [ ] 任务）' : '没有未完成的待办 🎉'}
            </div>
          {:else}
            {#each visibleTodos as item (item.noteId + ':' + item.offset)}
              <div class="todo-row" class:done={item.checked} data-todo-note={item.noteId} data-todo-offset={item.offset}>
                <input
                  type="checkbox" class="task-check todo-check" checked={item.checked}
                  aria-label={`${item.checked ? '取消完成' : '标记完成'}：${item.text}`}
                  onchange={() => void toggleTodo(item)}
                />
                <div class="todo-main">
                  <button
                    class="todo-text" title="跳转到该任务所在笔记"
                    onclick={() => void openTodoSource(item)}
                  >{item.text || '（空任务）'}</button>
                  <span class="todo-meta">📄 {item.title || '无标题笔记'} · {item.folder} · 第 {item.line + 1} 行</span>
                </div>
              </div>
            {/each}
          {/if}
        {:else if listItems.length === 0}
          <div class="list-empty">
            {query ? '没有匹配的结果' : view === 'trash' ? (trashFolders.length ? '' : '回收站是空的') : activeFolder ? '这个文件夹还没有笔记' : '还没有笔记'}
          </div>
        {:else}
          {#each listItems as item, i (item.id)}
            <div
              class="note-row grab"
              class:active={item.id === currentId && !isSelected(item.id)}
              class:selected={isSelected(item.id)}
              class:drop-line-top={dropLineIdx === i}
              class:drop-line-bottom={dropLineIdx === i + 1}
              title={item.pinned ? '已置顶（点击打开；拖拽可移动到文件夹）' : '点击打开；拖拽可移动到文件夹或手动排序'}
              oncontextmenu={(e) => onNoteRowCtx(e, item)}
              onclick={(e) => void onRowClick(item, e)}
              onpointerdown={(e) => {
                const ids = selectionMode && selectedIds.includes(item.id) ? [...selectedIds] : [item.id];
                beginPotentialNoteDrag(e, ids);
              }}
            >
              <div class="note-row-top">
                {#if selectionMode}
                  <input type="checkbox" class="row-check" checked={isSelected(item.id)} onchange={() => toggleSelection(item.id)} />
                {/if}
                {#if item.pinned}<span class="badge-pin" title="已置顶">📌</span>{/if}
                <span class="note-title">{visibleTitle(item)}</span>
                {#if item.deleted}<span class="badge-trash">🗑️ 回收站</span>{/if}
                {#if item.hit && item.where === 'title'}<span class="badge-where">标题</span>{/if}
              </div>
              {#if item.hit}
                <span class="note-snippet">{@html item.snippet ?? ''}</span>
                <span class="note-meta">
                  {item.where === 'title' ? '标题命中' : '正文命中'} · {relativeTime(item.updatedAt)}{item.deleted ? ' · 回收站' : ''}
                </span>
              {:else if item.excerpt}
                <span class="note-excerpt">{item.excerpt}</span>
                <span class="note-meta">
                  {#if view === 'trash'}原文件夹：{item.folder}{:else}{item.folder}{/if} · {relativeTime(item.deletedAt ?? item.updatedAt)}
                  {#if !item.hit && (item.tags ?? []).length > 0}
                    {' · '}{#each (item.tags ?? []).slice(0, 3) as t (t)}<span class="row-tag">#{t}</span>{/each}{#if (item.tags ?? []).length > 3}<span class="row-tag">+{(item.tags ?? []).length - 3}</span>{/if}
                  {/if}
                </span>
              {:else}
                <span class="note-meta">
                  {item.folder} · {relativeTime(item.updatedAt)}
                  {#if (item.tags ?? []).length > 0}
                    {' · '}{#each (item.tags ?? []).slice(0, 3) as t (t)}<span class="row-tag">#{t}</span>{/each}{#if (item.tags ?? []).length > 3}<span class="row-tag">+{(item.tags ?? []).length - 3}</span>{/if}
                  {/if}
                </span>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <!-- 手柄：笔记列 ⇄ 编辑区 -->
    <button
      class="seam seam-b" class:closed={!listOpen}
      title="展开 / 收回编辑区"
      aria-label={editorOpen ? '收回编辑区' : '展开编辑区'}
      onclick={toggleEditor}
    >
      <span class="seam-arrow">{editorOpen ? '◀' : '▶'}</span>
    </button>

    <!-- 右：编辑器 + 预览（图5） -->
    <section class="editor-pane" class:open={editorOpen}>
      {#if current}
        {#if current.deleted}
          <div class="trash-banner">
            <span>此笔记在回收站中（只读），还原后可继续编辑。</span>
            <button class="btn-primary small" onclick={restoreCurrent}>还原</button>
            <button class="btn-danger small" onclick={purgeCurrentFlow}>彻底删除</button>
          </div>
        {/if}
        <div class="ed-toolbar">
          <div class="ed-left">
            {#if !current.deleted}
              <select
                class="folder-chip" title="移动笔记到文件夹"
                value={current.folder}
                onchange={(e) => void onFolderChange((e.target as HTMLSelectElement).value)}
              >
                {#each folders as folder (folder)}
                  <option value={folder}>{folder}</option>
                {/each}
              </select>
            {/if}
            <input
              class="title-input" type="text" placeholder="无标题笔记…" spellcheck={settings.editor.spellcheck}
              value={current.title}
              readonly={current.deleted}
              oninput={onTitleInput}
            />
          </div>
          <div class="ed-right">
            {#if !current.deleted}
              <button
                class="btn-ghost small pin-btn" class:on={current.pinned}
                id="pin-toggle"
                title={current.pinned ? '取消置顶' : '置顶这条笔记'}
                aria-pressed={current.pinned}
                onclick={() => void setPinned(current!.id, !current!.pinned)}
              >📌 {current.pinned ? '已置顶' : '置顶'}</button>
            {/if}
            <div class="seg" id="mode-seg">
              <button class:active={mode === 'edit'} disabled={current.deleted} onclick={() => (mode = 'edit')}>编辑</button>
              <button class:active={mode === 'split'} onclick={() => (mode = 'split')}>分屏</button>
              <button class:active={mode === 'preview'} onclick={() => (mode = 'preview')}>预览</button>
            </div>
            <span class="save-status" class:saving={saveState === 'saving'} class:dirty={saveState === 'dirty'}>
              {current.deleted ? '回收站' : saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '未保存' : saveState === 'saved' && lastSavedAt ? `已保存 ${relativeTime(lastSavedAt)}` : '已保存'}
            </span>
            {#if !current.deleted}
              <button class="btn-danger" onclick={trashCurrentFlow} title="移入回收站">删除</button>
            {/if}
          </div>
        </div>

        <!-- 标签编辑（读写 frontmatter 的 tags；直接落盘，不受正文去抖影响） -->
        <div class="tag-editor" id="tag-editor">
          <span class="tag-editor-label">标签</span>
          {#each current.tags as tag (tag)}
            <span class="tag-chip editable" data-tag={tag}>
              #{tag}
              {#if !current.deleted}
                <button class="tag-remove" title={`移除标签 #${tag}`} aria-label={`移除标签 ${tag}`} onclick={() => removeTagFromCurrent(tag)}>✕</button>
              {/if}
            </span>
          {/each}
          {#if !current.deleted}
            <input
              class="tag-input" id="tag-input" type="text" placeholder="添加标签后回车（空格/逗号可分隔多个）"
              value={tagDraft} autocomplete="off" spellcheck="false"
              oninput={(e) => (tagDraft = (e.target as HTMLInputElement).value)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); commitTagDraft(); }
                else if (e.key === 'Backspace' && !tagDraft && current && current.tags.length > 0) {
                  e.preventDefault();
                  removeTagFromCurrent(current.tags[current.tags.length - 1]);
                }
              }}
              onblur={commitTagDraft}
            />
          {:else if current.tags.length === 0}
            <span class="tag-editor-empty">（无标签）</span>
          {/if}
        </div>

        <div class="workspace">
          {#if mode !== 'preview'}
            <textarea
              id="editor"
              bind:this={editorRef}
              class="editor" placeholder="开始书写…（支持 Markdown：# 标题、- [ ] 待办、``` 代码块）"
              class:todo-flash={todoHighlight?.id === current.id}
              spellcheck={settings.editor.spellcheck}
              value={current.body}
              readonly={current.deleted}
              oninput={onBodyInput}
            ></textarea>
          {/if}
          {#if mode !== 'edit'}
            <div
              class="preview" id="preview"
              bind:this={previewEl}
              use:previewAction
            >
              {@html previewRender?.html ?? ''}
            </div>
          {/if}
        </div>

        <footer class="statusbar">
          <span>{totalNotes} 条笔记</span>
          <span class="sep">·</span>
          <span>{previewTasks.length > 0 ? `${previewTasks.filter((t) => t.checked).length}/${previewTasks.length} 待办已完成` : '无待办'}</span>
          <span class="spacer"></span>
          {#if current.tags.length > 0}<span>{current.tags.length} 个标签</span><span class="sep">·</span>{/if}
          <span>{current.body.length} 字符</span>
        </footer>
      {:else}
        <div class="empty-editor">
          <div class="empty-icon">🗒️</div>
          <h3>{listItems.length === 0 ? '这里还没有笔记' : '选择一条笔记开始'}</h3>
          <p>点击左侧「＋ 新建笔记」写下第一条记录。</p>
        </div>
      {/if}
    </section>
  </main>
{/if}

<!-- 右键菜单 -->
{#if ctx}
  <ContextMenu x={ctx.x} y={ctx.y} rows={ctx.rows} onClose={closeCtx} />
{/if}

<!-- 快捷键帮助 -->
{#if helpOpen}
  <div
    class="overlay"
    role="button" tabindex="-1" aria-label="关闭快捷键帮助"
    onclick={(e) => { if (e.target === e.currentTarget) helpOpen = false; }}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); helpOpen = false; } }}
  >
    <div class="panel help-card">
      <h3>⌨️ 快捷键与操作</h3>
      <table>
        <tbody>
          {#each registry.list() as def}
            <tr>
              <td><kbd>{displayShortcut(def)}</kbd></td>
              <td>{def.label}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <ul class="help-tips">
        <li>三栏是“级联收起/展开”：默认仅显示侧栏（图3）；点文件夹滑出笔记列（图4）；点笔记滑出编辑区（图5）。</li>
        <li>再点一次当前文件夹/笔记可逐级收回；栏与栏之间的手柄 ◀ / ▶ 也可展开或收回。</li>
        <li>右键文件夹/空白区/笔记行打开上下文菜单；双击文件夹名重命名。</li>
        <li>拖拽文件夹可排序；拖拽笔记到文件夹即移动，拖到回收站即删除；列表内拖动可手动排序。</li>
        <li>「选择」模式（或 Ctrl/Shift+点击）多选后可批量移入回收站 / 还原 / 彻底删除。</li>
        <li>删除的笔记与文件夹先进回收站，可整组还原；“清空回收站”才会物理删除。</li>
        <li>全局搜索包含回收站命中（带 🗑️ 标记，点击转入回收站查看）。</li>
        <li>标签：编辑区「标签」一行回车添加（空格/逗号分隔可一次加多个），点标签条可按标签筛选；标签写在文件 frontmatter 的 tags 里。</li>
        <li>置顶：编辑区「📌 置顶」或笔记行右键；置顶笔记固定排在列表最前，可多选后批量置顶。</li>
        <li>待办：左栏「☑️ 待办」汇总全库未完成任务；勾选即回写源文，点任务文本跳回原笔记并定位该行；可切换是否显示已完成。</li>
      </ul>
      <button class="btn-primary" onclick={() => (helpOpen = false)}>知道了</button>
    </div>
  </div>
{/if}

<!-- 确认对话框 -->
{#if confirm}
  <div
    class="overlay"
    role="button" tabindex="-1" aria-label="关闭确认框"
    onclick={(e) => { if (e.target === e.currentTarget) confirm = null; }}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); confirm = null; } }}
  >
    <div class="panel modal-card">
      <h3>{confirm.title}</h3>
      <p>{confirm.message}</p>
      <div class="modal-actions">
        <button class="btn-ghost" onclick={() => (confirm = null)}>取消</button>
        <button class={confirm.danger ? 'btn-danger' : 'btn-primary'} onclick={() => confirm?.onOk()}>{confirm.okLabel ?? '确定'}</button>
      </div>
    </div>
  </div>
{/if}

<!-- 输入对话框 -->
{#if prompt}
  <div
    class="overlay"
    role="button" tabindex="-1" aria-label="关闭输入框"
    onclick={(e) => { if (e.target === e.currentTarget) prompt = null; }}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); prompt = null; } }}
  >
    <div class="panel modal-card">
      <h3>{prompt.title}</h3>
      <input
        class="prompt-input"
        type="text"
        value={prompt.value}
        placeholder={prompt.placeholder}
        oninput={(e) => (prompt = { ...prompt, value: (e.target as HTMLInputElement).value })}
      />
      <div class="modal-actions">
        <button class="btn-ghost" onclick={() => (prompt = null)}>取消</button>
        <button class="btn-primary" onclick={() => prompt?.onOk(prompt.value)}>{prompt.okLabel ?? '创建'}</button>
      </div>
    </div>
  </div>
{/if}

<!-- 轻提示 -->
{#if toasts.length > 0}
  <div class="toasts">
    {#each toasts as t (t.id)}
      <div class="toast">{t.text}</div>
    {/each}
  </div>
{/if}
