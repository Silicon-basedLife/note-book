<script lang="ts">
  // App.svelte —— NoteApp 主窗口（三栏：文件夹 / 笔记列表 / 编辑+预览）
  // P0 功能 + 增强版交互：文件夹右键菜单/悬停删除/拖拽排序、笔记多选批量进回收站、
  // 笔记拖拽移动/手排、回收站（还原/彻底删除/清空）、左侧收边窄条。
  import { onMount } from 'svelte';
  import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
  import ContextMenu from './ui/ContextMenu.svelte';
  import { createCore, displayTitle, excerptOf } from '../shared/core-client.ts';
  import { renderMarkdown } from '../lib/core/markdown.ts';
  import { plainTextOf } from '../lib/core/index.ts';
  import { relativeTime } from '../lib/core/format.ts';
  import { SCOPE_ALL } from '../lib/core/store.ts';
  import { ActionRegistry, type ActionDef, type Shortcut } from '../lib/core/actions.ts';
  import type { NoteCore } from '../lib/core/store.ts';
  import type { NoteDoc, SearchHit, TrashFolderInfo } from '../lib/core/types.ts';

  const AUTO_SAVE_MS = 600;

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
  let ready = $state(false);
  let folders = $state<string[]>([]);
  let counts = $state<Record<string, number>>({});
  let activeFolder = $state<string | null>(null); // null = 全部
  let view = $state<'notes' | 'trash'>('notes');
  let trashCounts = $state<{ notes: number; folders: number }>({ notes: 0, folders: 0 });
  let trashFolders = $state<TrashFolderInfo[]>([]);
  let query = $state('');
  let mode = $state<'edit' | 'split' | 'preview'>('split');
  let listItems = $state<ListItem[]>([]);
  let currentId = $state<string | null>(null);
  let current = $state<{ id: string; title: string; body: string; folder: string; updatedAt: string; deleted?: boolean; deletedAt?: string } | null>(null);
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
  let dropLineIdx = $state<number | null>(null);     // 中间列表插入线位置
  let dragFolderIdx = $state<number | null>(null);   // 正在拖拽的文件夹下标
  let folderDropIdx = $state<number | null>(null);   // 文件夹排序插入位置（0..len）

  const registry = new ActionRegistry();

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
    saveTimer = setTimeout(() => { saveTimer = undefined; scheduleSave(); }, AUTO_SAVE_MS);
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

    if (view === 'trash') {
      if (q) {
        const hits: SearchHit[] = (core.search(q, null, { includeTrash: true }) ?? []).filter((h) => h.deleted);
        listItems = hits.map((h) => rowFromHit(h));
      } else {
        listItems = core.listTrashNotes().map((n) => ({
          id: n.id, folder: n.folder, title: displayTitle(n),
          updatedAt: n.updatedAt, deletedAt: n.deletedAt,
          excerpt: n.body ? excerptOf(plainTextOf(n.body)) : '',
          deleted: true,
        }));
      }
      manualScope = null;
    } else {
      if (q) {
        const includeTrash = activeFolder === null;
        const hits: SearchHit[] = core.search(q, activeFolder, { includeTrash }) ?? [];
        listItems = hits.map((h) => rowFromHit(h));
        manualScope = null;
      } else {
        const scope = activeFolder ?? SCOPE_ALL;
        manualScope = core.getNoteOrder(scope)?.length ? scope : null;
        listItems = core.listNotesOrdered(scope).map((n) => ({
          id: n.id, folder: n.folder, title: displayTitle(n),
          updatedAt: n.updatedAt,
          excerpt: n.body ? excerptOf(plainTextOf(n.body)) : '',
        }));
      }
    }
    // 选中项去重/清理（列表刷新后仍在其中的保留）
    selectedIds = selectedIds.filter((id) => listItems.some((it) => it.id === id));
    if (selectedIds.length === 0 && selectionMode) { /* 空选可继续模式 */ }
    if (currentId) {
      const doc = core.getNote(currentId);
      if (doc && current) {
        current.updatedAt = doc.updatedAt;
        current.folder = doc.folder;
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
    if (currentId === id && current && !current.deleted) { saveState = 'saved'; return; }
    await flush();
    const doc = core.getNote(id);
    if (!doc) return;
    currentId = id;
    current = {
      id: doc.id, title: doc.title, body: doc.body, folder: doc.folder,
      updatedAt: doc.updatedAt, deleted: doc.deleted ?? false, deletedAt: doc.deletedAt,
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
  function goView(v: 'notes' | 'trash') {
    closeCtx();
    selectionMode = false;
    selectedIds = [];
    view = v;
    query = '';
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
    if (selectionMode || e.ctrlKey || e.metaKey || e.shiftKey) {
      if (!selectionMode && (e.ctrlKey || e.metaKey)) enterSelection();
      toggleSelection(item.id, e);
      return;
    }
    // 再点当前已展开的笔记 → 收回编辑区（图5 → 图4）
    if (item.id === currentId && editorOpen) { editorOpen = false; return; }
    openNoteItem(item);
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
    if (!from || renameValue.trim() === from) return;
    const r = await core.renameFolder(from, renameValue.trim());
    if (!r.ok) toast(r.reason ?? '重命名失败');
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

  // ---------- 排序（文件夹拖拽 / 笔记手排） ----------
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
  async function commitNoteReorder() {
    if (!draggingNoteIds?.length || dropLineIdx === null) { draggingNoteIds = null; dropLineIdx = null; return; }
    const scope = currentScope;
    const ids = draggingNoteIds;
    draggingNoteIds = null;
    dropLineIdx = null;
    if (!scope) return;
    const currentIds = listItems.map((it) => it.id);
    let insertAt = dropLineIdx;
    // 移除被拖动的 id（它们在原列表中的位置）；按 dropLineIdx 相对删除后的序列插回
    let removed = 0;
    let insertPos = insertAt;
    const rest: string[] = [];
    for (let i = 0; i < currentIds.length; i++) {
      const id = currentIds[i];
      if (ids.includes(id)) { removed += 1; if (i < insertAt) insertPos -= 1; continue; }
      rest.push(id);
    }
    void removed;
    const toInsert = ids.filter((id) => rest.includes(id) || currentIds.includes(id));
    const final = [...rest];
    final.splice(Math.max(0, Math.min(insertPos, final.length)), 0, ...toInsert);
    await core.setNoteOrder(scope, final);
    refresh();
  }

  async function moveNotesToFolder(ids: string[], folder: string) {
    for (const id of ids) {
      const doc = core.getNote(id);
      if (doc && doc.folder !== folder) await core.updateNote(id, { folder });
    }
    if (current && ids.includes(current.id)) current.folder = folder;
    overFolderName = null;
    draggingNoteIds = null;
    dropLineIdx = null;
    refresh();
  }
  async function trashNotesDrop(ids: string[]) {
    await core.deleteNotes(ids);
    draggingNoteIds = null;
    overFolderName = null;
    dropLineIdx = null;
    if (currentId && ids.includes(currentId)) { currentId = null; current = null; }
    refresh();
    toast(`已将 ${ids.length} 条笔记移入回收站`);
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
  async function syncWindowSize() {
    if (!core || !isTauri()) return;
    try {
      const cur = await getCurrentWindow().outerSize();
      await getCurrentWindow().setSize(new LogicalSize(computeWidth(), cur.height));
    } catch { /* 忽略（如窗口被系统限制） */ }
  }

  // 面板开合 → 窗口宽度随之变化
  $effect(() => {
    void syncWindowSize();
  });

  function registerActions() {
    registry.register({ id: 'new-note', label: '新建笔记', shortcut: { key: 'n', alt: true }, run: () => { if (ready) void newNote(); } });
    registry.register({ id: 'focus-search', label: '聚焦搜索', shortcut: { key: 'k', ctrl: true }, run: () => { if (ready) searchEl?.focus(); } });
    registry.register({ id: 'save-now', label: '立即保存', shortcut: { key: 's', ctrl: true }, run: () => { if (ready) void flush(); } });
    registry.register({ id: 'help', label: '快捷键帮助', shortcut: { key: '?', shift: true }, run: () => { helpOpen = !helpOpen; } });
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
    registerActions();
    window.addEventListener('keydown', onGlobalKey);
    const flushTimer = () => { if (saveState !== 'idle') void flush(); };
    window.addEventListener('beforeunload', flushTimer);
    window.addEventListener('blur', flushTimer);
    void (async () => {
      core = await createCore();
      core.on(() => refresh());
      ready = true;
      refresh();
      void syncWindowSize(); // 初始收缩到“仅侧栏”（图3）宽度
      // 默认保持图3（仅侧栏）；由用户点文件夹/点笔记逐级展开
    })();
    return () => {
      window.removeEventListener('keydown', onGlobalKey);
      window.removeEventListener('beforeunload', flushTimer);
      window.removeEventListener('blur', flushTimer);
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
                  class="folder-main"
                  draggable="true"
                  onclick={() => toggleFolder(folder)}
                  ondblclick={(e) => { e.stopPropagation(); startRenameFolder(folder); }}
                  ondragstart={(e) => {
                    dragFolderIdx = fi;
                    overFolderName = null;
                    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
                  }}
                  ondragover={(e) => {
                    e.preventDefault();
                    if (dragFolderIdx === null) {
                      // 笔记拖入文件夹：高亮目标
                      folderDropIdx = null;
                      if (draggingNoteIds?.length) overFolderName = folder;
                      return;
                    }
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const base = e.clientY < rect.top + rect.height / 2 ? fi : fi + 1;
                    folderDropIdx = dragFolderIdx < base ? base - 1 : base;
                  }}
                  ondragleave={() => {
                    if (dragFolderIdx === null && overFolderName === folder) overFolderName = null;
                  }}
                  ondrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragFolderIdx !== null) {
                      const toIdx = folderDropIdx ?? fi;
                      void commitFolderDrop(dragFolderIdx, toIdx);
                      return;
                    }
                    // 笔记拖入文件夹 → 移动
                    if (draggingNoteIds?.length) {
                      void moveNotesToFolder(draggingNoteIds, folder);
                    }
                  }}
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
          class="nav-item trash-entry"
          class:active={view === 'trash'}
          onclick={() => goView('trash')}
        >
          <span class="nav-ico">🗑️</span>回收站
          <span class="nav-count">{trashCounts.notes + trashCounts.folders}</span>
        </button>
      </div>

      <div class="sb-foot">
        <button class="btn-ghost" onclick={() => (helpOpen = true)}>⌨️ 快捷键</button>
        <span class="sb-storage">存储：{core ? (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? '本机文件' : '本机（IndexedDB）') : ''}</span>
      </div>
    </aside>

    <!-- 手柄：侧栏 ⇄ 笔记列 -->
    <button
      class="seam seam-a" title="展开 / 收回笔记列"
      aria-label={listOpen ? '收回笔记列' : '展开笔记列'}
      onclick={toggleList}
    >
      <span class="seam-arrow">{listOpen ? '◀' : '▶'}</span>
    </button>

    <!-- 中：搜索 + 笔记列表（图4） -->
    <section class="list-pane" class:open={listOpen}>
      <div class="list-head">
        <h2>{view === 'trash' ? '回收站' : (activeFolder ?? '全部笔记')}</h2>
        <div class="head-actions">
          <span class="list-sub">
            {#if query}
              搜索结果
            {:else if view === 'trash'}
              {trashCounts.notes + trashCounts.folders} 项
            {:else if manualScope}
              手动排序
            {:else}
              按更新时间排序
            {/if}
          </span>
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

        {#if listItems.length === 0}
          <div class="list-empty">
            {query ? '没有匹配的结果' : view === 'trash' ? (trashFolders.length ? '' : '回收站是空的') : activeFolder ? '这个文件夹还没有笔记' : '还没有笔记'}
          </div>
        {:else}
          {#each listItems as item, i (item.id)}
            <div
              class="note-row"
              class:active={item.id === currentId && !isSelected(item.id)}
              class:selected={isSelected(item.id)}
              class:drop-line-top={dropLineIdx === i}
              class:drop-line-bottom={dropLineIdx === i + 1}
              draggable="true"
              oncontextmenu={(e) => onNoteRowCtx(e, item)}
              onclick={(e) => void onRowClick(item, e)}
              ondragstart={(e) => {
                if (view === 'trash') { e.preventDefault(); return; }
                draggingNoteIds = selectedIds.includes(item.id) ? [...selectedIds] : [item.id];
                folderDropIdx = null;
                if (e.dataTransfer) {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', draggingNoteIds.join(','));
                }
              }}
              ondragend={() => { draggingNoteIds = null; overFolderName = null; dropLineIdx = null; folderDropIdx = null; }}
              ondragover={(e) => {
                if (!draggingNoteIds || query) return;
                e.preventDefault();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                dropLineIdx = e.clientY < rect.top + rect.height / 2 ? i : i + 1;
              }}
              ondrop={(e) => {
                e.preventDefault();
                void commitNoteReorder();
              }}
            >
              <div class="note-row-top">
                {#if selectionMode}
                  <input type="checkbox" class="row-check" checked={isSelected(item.id)} onchange={() => toggleSelection(item.id)} />
                {/if}
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
                </span>
              {:else}
                <span class="note-meta">{item.folder} · {relativeTime(item.updatedAt)}</span>
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
              class="title-input" type="text" placeholder="无标题笔记…" spellcheck="false"
              value={current.title}
              readonly={current.deleted}
              oninput={onTitleInput}
            />
          </div>
          <div class="ed-right">
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

        <div class="workspace">
          {#if mode !== 'preview'}
            <textarea
              id="editor"
              bind:this={editorRef}
              class="editor" placeholder="开始书写…（支持 Markdown：# 标题、- [ ] 待办、``` 代码块）"
              spellcheck="false"
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
