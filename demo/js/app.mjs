// app.mjs —— 演示界面交互 v2
// 覆盖改进需求：文件夹右键菜单/重命名/悬停删除/拖拽排序，笔记拖入文件夹/排序/批量删除，
// 文件夹→笔记两级级联展开，回收站（还原/彻底删除/清空），搜索含回收站，靠边隐藏模拟。
import {
  defaultSeed, createFolder, renameFolder, applyFolderOrder, deleteFolder, restoreFolder, purgeFolder,
  createNote, updateNote, deleteNotes, restoreNote, purgeNotes, moveNoteToFolder, applyNoteOrder,
  getFolder, folderNameOf, activeFolders, notesOfFolder, allActiveNotes, trashedFolders, trashedNotes, binCount,
  searchNotes, plainTextOf, relativeTime, toggleTask,
  loadSavedLocal, saveStateLocal, clearSavedLocal,
} from './store.mjs';
import { dbLoad, dbSave, dbClear } from './db.mjs';
import { renderMarkdown } from './markdown.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const els = {
  tree: $('tree'),
  binWrap: $('bin-wrap'),
  navScroll: $('nav-scroll'),
  searchInput: $('search-input'),
  searchClear: $('search-clear'),
  btnNew: $('btn-new'),
  btnNewFolder: $('btn-new-folder'),
  btnHelp: $('btn-help'),
  btnReset: $('btn-reset'),
  helpClose: $('help-close'),
  helpPanel: $('help-panel'),
  ctxMenu: $('ctx-menu'),
  modalMask: $('modal-mask'),
  modalTitle: $('modal-title'),
  modalMessage: $('modal-message'),
  modalOk: $('modal-ok'),
  modalCancel: $('modal-cancel'),
  ctxChip: $('ctx-chip'),
  titleInput: $('title-input'),
  saveStatus: $('save-status'),
  btnRestore: $('btn-restore'),
  btnDelete: $('btn-delete'),
  noteBanner: $('note-banner'),
  modeSeg: $('mode-seg'),
  workspace: $('workspace'),
  editor: $('editor'),
  preview: $('preview'),
  emptyEditor: $('empty-editor'),
  statusNotes: $('status-notes'),
  toasts: $('toasts'),
  dockToggle: $('dock-toggle'),
  dockBar: $('dock-bar'),
};

// ---------- 状态 ----------
const state = {
  folders: [],
  notes: [],
  expanded: null,      // 'all' | folderId | 'bin' | null
  query: '',
  currentId: null,
  selIds: new Set(),
  multi: false,
  mode: 'split',
  dirty: false,
  saveTimer: null,
  editFolderId: null,
  docked: false,
  peeked: false,
  dockTimer: null,
};

const getNote = (id) => state.notes.find((n) => n.id === id) || null;
const getFolderRow = (id) => getFolder(state.folders, id);
const currentNote = () => getNote(state.currentId);
const q = () => state.query.trim();
const isTrash = (note) => !!note.trashed;

// ---------- 持久化（IndexedDB 主通道，localStorage 降级） ----------
async function persist() {
  const ok = await dbSave({ folders: state.folders, notes: state.notes });
  if (!ok) saveStateLocal({ folders: state.folders, notes: state.notes });
}

// ---------- 启动 ----------
async function boot() {
  let data = null;
  try { data = await dbLoad(); } catch { data = null; }
  if (!data) data = loadSavedLocal(() => defaultSeed());
  state.folders = data.folders || [];
  state.notes = data.notes || [];

  // 默认展开第一个文件夹并打开其中第一篇笔记
  const af = activeFolders(state.folders);
  state.expanded = af.length ? af[0].id : 'all';
  const first = af.length ? notesOfFolder(state.notes, af[0].id)[0] : null;
  state.currentId = first ? first.id : null;

  bind();
  renderAll();
}

// =========================================================
// 渲染：侧边树 / 回收站 / 内容区
// =========================================================
function renderAll() {
  renderSidebar();
  renderContent();
  renderStatus();
}

function renderSidebar() {
  if (q()) renderSearchList();
  else {
    els.tree.innerHTML = treeHtml();
    els.tree.hidden = false;
    bindDynamicInputs(els.tree);
  }
  renderBin();
  document.body.classList.toggle('multi', state.multi || state.selIds.size > 0);
}

// ---- 树形 HTML（全部笔记 + 文件夹） ----
function treeHtml() {
  const af = activeFolders(state.folders);
  const allNotes = allActiveNotes(state.notes, state.folders);
  const parts = [];
  parts.push(blockRowHtml({ kind: 'all', id: 'all', ico: '🗂️', name: '全部笔记', count: allNotes.length }));
  if (state.expanded === 'all') {
    parts.push(listHtml('all', allNotes, '全部笔记'));
  }
  for (const f of af) {
    const notes = notesOfFolder(state.notes, f.id);
    parts.push(blockRowHtml({ kind: 'folder', id: f.id, ico: '📁', name: f.name, count: notes.length }));
    if (state.expanded === f.id) {
      parts.push(listHtml(f.id, notes, f.name));
    }
  }
  if (!af.length) {
    parts.push('<div class="list-empty small">暂无文件夹<br>右键空白处或点上方「＋ 文件夹」新建</div>');
  }
  return parts.join('');
}

function blockRowHtml({ kind, id, ico, name, count }) {
  const expanded = state.expanded === id && !q();
  const active = expanded;
  const renaming = state.editFolderId === id;
  const nameCell = renaming
    ? `<input class="rename-input" data-rename-input value="${esc(getFolder(state.folders, id)?.name ?? name)}">`
    : `<span class="tname">${esc(name)}</span>`;
  return `<div class="trow ${kind === 'folder' ? 'folder-row' : ''}${active ? ' active expanded' : ''}" data-kind="${kind}" data-id="${id}"${kind === 'folder' && !renaming ? ' draggable="true"' : ''}>
    <span class="twisty">${expanded ? '▼' : '▶'}</span>
    <span class="t-ico">${ico}</span>
    ${nameCell}
    <span class="fcount">
      <span class="cnt">${count}</span>
      ${kind === 'folder' ? `<button class="fdel" data-act="folder-del" data-id="${id}" title="删除文件夹（连同笔记移入回收站）">✕</button>` : ''}
    </span>
  </div>`;
}

// 某个集合的笔记列表（含“选择/批量”头部）
function listHtml(owner, notes, ownerName) {
  const n = notes.length;
  const multiOn = state.multi;
  const selCount = state.selIds.size;
  let head = `<div class="tnotes-head"><span class="hint">${ownerName} · ${n} 条</span>
    <button class="chip-btn${multiOn ? ' active' : ''}" data-act="toggle-multi" data-owner="${owner}">${multiOn ? '完成' : '选择'}</button>`;
  if (selCount > 0) {
    head += `<button class="chip-btn danger" data-act="batch-del">移入回收站 (${selCount})</button>`;
  }
  head += '</div>';
  const rows = notes.length
    ? `<ul class="nlist" data-list="${owner}">${notes.map((note) => noteRowHtml(note, owner)).join('')}</ul>`
    : '<div class="list-empty small">该文件夹还没有笔记<br>右键文件夹 →「新建笔记」</div>';
  return `<div class="tnotes">${head}${rows}</div>`;
}

function noteRowHtml(note, owner) {
  const active = state.currentId === note.id;
  const checked = state.selIds.has(note.id);
  const folder = folderNameOf(state.folders, note.folderId);
  const chips = [];
  if (owner === 'all') chips.push(`<span class="chip">${esc(folder)}</span>`);
  if (owner === 'search') chips.push(`<span class="chip ${isTrash(note) ? 'trash' : ''}">${esc(folder)}</span>`);
  if (owner === 'bin') chips.push(`<span class="chip warn">原：${esc(folder)}</span>`);
  if (isTrash(note) && owner !== 'bin') chips.push('<span class="chip trash">回收站</span>');
  const snip = plainTextOf(note.body);
  return `<li class="nrow${active ? ' active' : ''}" data-kind="note" data-id="${note.id}" data-trash="${isTrash(note) ? 1 : 0}" draggable="true">
    <input type="checkbox" class="ncheck" data-act="check" ${checked ? 'checked' : ''} title="多选">
    <div class="nmain">
      <div class="ntitle">${esc(note.title || '（无标题笔记）')}</div>
      <div class="nsnip">${esc(snip.length > 46 ? snip.slice(0, 46) + '…' : snip)}</div>
      ${chips.length ? `<div class="nmeta">${chips.join('')}<span>${relativeTime(note.updatedAt)}</span></div>` : ''}
    </div>
    <span class="ntime">${relativeTime(note.updatedAt)}</span>
  </li>`;
}

// ---- 搜索视图 ----
function renderSearchList() {
  const results = searchNotes(state.notes, state.folders, state.query);
  if (!results.length) {
    els.tree.innerHTML = `<div class="list-empty">没有匹配「${esc(state.query)}」的笔记（已搜索全部，含回收站）</div>`;
    return;
  }
  const rows = results.map((r) => {
    const note = r.note;
    const active = state.currentId === note.id;
    const checked = state.selIds.has(note.id);
    const chips = [`<span class="chip ${isTrash(note) ? 'trash' : ''}">${esc(r.folderName)}</span>`];
    if (isTrash(note)) chips.push('<span class="chip trash">回收站</span>');
    return `<li class="nrow${active ? ' active' : ''}" data-kind="note" data-id="${note.id}" data-trash="${isTrash(note) ? 1 : 0}">
      <input type="checkbox" class="ncheck" data-act="check" ${checked ? 'checked' : ''} title="多选">
      <div class="nmain">
        <div class="ntitle">${esc(note.title || '（无标题笔记）')}</div>
        <div class="nsnip">${r.snippet}</div>
        <div class="nmeta">${chips.join('')}<span>${relativeTime(note.updatedAt)}</span></div>
      </div>
      <span class="ntime">${relativeTime(note.updatedAt)}</span>
    </li>`;
  }).join('');
  els.tree.innerHTML = `<div class="nav-label">搜索 “${esc(state.query)}” · ${results.length} 条（含回收站）</div>
    <ul class="nlist">${rows}</ul>
    <div class="list-empty small">回车打开第一条 · Ctrl+K 聚焦 · Esc 清除</div>`;
}

// ---- 回收站 ----
function renderBin() {
  const tFolders = trashedFolders(state.folders);
  const tNotes = trashedNotes(state.notes);
  const total = tFolders.length + tNotes.length;
  const expanded = state.expanded === 'bin' && !q();

  let html = `<div class="trow bin-row${expanded ? ' active expanded' : ''}" data-kind="bin" data-id="bin">
    <span class="twisty">${expanded ? '▼' : '▶'}</span>
    <span class="t-ico">🗑️</span>
    <span class="tname">回收站</span>
    <span class="fcount"><span class="cnt">${total}</span></span>
  </div>`;
  if (expanded) {
    const items = [];
    for (const f of tFolders) {
      const cnt = notesOfFolder(state.notes, f.id).length;
      items.push(`<li class="nrow trash-item" data-kind="trash-folder" data-id="${f.id}">
        <span class="t-ico">📁</span>
        <div class="nmain"><div class="ntitle">${esc(f.name)}</div>
        <div class="nmeta"><span class="chip trash">文件夹</span><span>含 ${cnt} 条笔记</span></div></div>
      </li>`);
    }
    for (const note of tNotes) {
      items.push(noteRowHtml(note, 'bin'));
    }
    html += `<div class="bin-items"><div class="tnotes-head">
        <span class="hint">右键条目可还原 / 彻底删除</span>
        ${total ? '<button class="chip-btn danger" data-act="empty-bin">清空回收站</button>' : ''}
      </div>
      <ul class="nlist">${items.join('')}</ul>
      ${items.length ? '' : '<div class="list-empty small">回收站是空的</div>'}
    </div>`;
  }
  els.binWrap.innerHTML = html;
}

// 重命名输入的事件绑定（渲染后调用）
function bindDynamicInputs(root) {
  root.querySelectorAll('[data-rename-input]').forEach((input) => {
    const fid = input.closest('[data-id]')?.dataset.id;
    input.focus();
    input.select();
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { commitRename(fid, input.value); }
      if (e.key === 'Escape') { state.editFolderId = null; renderSidebar(); }
    });
    input.addEventListener('blur', () => { if (state.editFolderId === fid) commitRename(fid, input.value); });
  });
}

function commitRename(folderId, value) {
  const changed = (getFolderRow(folderId)?.name || '') !== (value || '').trim();
  const next = renameFolder(state.folders, folderId, value);
  if (next !== state.folders) state.folders = next;
  state.editFolderId = null;
  if (changed) {
    persist();
    toast('已重命名文件夹');
  }
  renderSidebar();
}

// =========================================================
// 内容区
// =========================================================
function renderContent() {
  const note = currentNote();
  const has = !!note;
  const trash = has && isTrash(note);

  els.titleInput.value = has ? note.title : '';
  els.editor.value = has ? note.body : '';
  els.titleInput.disabled = !has || trash;
  els.editor.disabled = !has || trash;
  els.emptyEditor.hidden = has;

  els.ctxChip.textContent = !has ? '—' : trash ? '回收站' : folderNameOf(state.folders, note.folderId);
  els.ctxChip.classList.toggle('trash-chip', trash);

  els.noteBanner.hidden = !trash;
  els.noteBanner.textContent = trash ? `该笔记位于回收站（原文件夹：${folderNameOf(state.folders, note.folderId)}），可浏览/还原/彻底删除，编辑已禁用。` : '';

  els.btnRestore.hidden = !trash;
  els.btnRestore.disabled = !has;
  els.btnDelete.disabled = !has;
  els.btnDelete.textContent = trash ? '彻底删除' : '移入回收站';

  if (!has) els.preview.innerHTML = '';
  else renderPreview();
}

function renderPreview() {
  const note = currentNote();
  if (!note) { els.preview.innerHTML = ''; return; }
  const { html } = renderMarkdown(note.body);
  els.preview.innerHTML = html;
}

function renderStatus() {
  const active = state.notes.filter((n) => !n.trashed).length;
  const trash = binCount(state.notes, state.folders);
  els.statusNotes.textContent = `${active} 条笔记 · ${state.folders.filter((f) => !f.trashed).length} 个文件夹 · 回收站 ${trash}`;
}

// =========================================================
// 选择 / 打开
// =========================================================
function clearSelection() {
  state.selIds.clear();
  state.multi = false;
}

function openNote(id) {
  const note = getNote(id);
  if (!note) return;
  state.currentId = id;
  // 从搜索中打开 → 跳转到对应上下文并清空搜索，使高亮可见
  if (q()) {
    state.query = '';
    els.searchInput.value = '';
    state.expanded = isTrash(note) ? 'bin' : note.folderId;
    clearSelection();
  }
  renderSidebar();
  renderContent();
}

function expandKey(key) {
  state.expanded = state.expanded === key ? null : key;
  clearSelection();
  renderSidebar();
}

// 在“展开的集合”内切换选择
function toggleSelect(id) {
  if (state.selIds.has(id)) state.selIds.delete(id);
  else state.selIds.add(id);
  if (!state.selIds.size) state.multi = false;
  renderSidebar();
}

// =========================================================
// 删除 / 还原 / 批量（回收站语义）
// =========================================================
function trashNotesFlow(ids, opts = {}) {
  const msg = opts.msg || `将 ${ids.length} 条笔记移入回收站？可随时在回收站还原。`;
  openConfirm({ title: '移入回收站', message: msg, okText: '移入回收站' }).then((ok) => {
    if (!ok) return;
    const wasCurrent = ids.includes(state.currentId);
    state.notes = deleteNotes(state.notes, ids);
    if (wasCurrent) pickNeighborAfterRemoval(ids);
    clearSelection();
    persist();
    renderAll();
    toast(`已移入回收站 ${ids.length} 条`);
  });
}

function pickNeighborAfterRemoval(removedIds) {
  const rem = new Set(removedIds);
  let list = [];
  if (state.expanded === 'all') list = allActiveNotes(state.notes, state.folders);
  else if (state.expanded && state.expanded !== 'bin') list = notesOfFolder(state.notes, state.expanded);
  state.currentId = (list.find((n) => !rem.has(n.id)) || state.notes.find((n) => !n.trashed) || null)?.id ?? null;
}

function deleteSingle(id) {
  const note = getNote(id);
  if (!note) return;
  if (isTrash(note)) {
    openConfirm({ title: '彻底删除？', message: `“${note.title || '无标题笔记'}”将从回收站永久删除，无法恢复。`, okText: '彻底删除' }).then((ok) => {
      if (!ok) return;
      state.notes = purgeNotes(state.notes, [id]);
      if (state.currentId === id) state.currentId = null;
      clearSelection();
      persist();
      renderAll();
      toast('已彻底删除');
    });
  } else {
    trashNotesFlow([id], { msg: `将“${note.title || '无标题笔记'}”移入回收站？可随时还原。` });
  }
}

function deleteFolderFlow(folderId) {
  const folder = getFolderRow(folderId);
  if (!folder || folder.trashed) return;
  const cnt = notesOfFolder(state.notes, folderId).length;
  openConfirm({
    title: `删除文件夹「${folder.name}」？`,
    message: `文件夹与其内 ${cnt} 条笔记将一起移入回收站（保留结构，可整体还原）。`,
    okText: '移入回收站',
  }).then((ok) => {
    if (!ok) return;
    const res = deleteFolder(state.folders, state.notes, folderId);
    state.folders = res.folders;
    state.notes = res.notes;
    const affected = state.notes.some((n) => n.id === state.currentId && n.trashed && n.folderId === folderId);
    if (affected) state.currentId = null;
    if (state.expanded === folderId) state.expanded = null;
    clearSelection();
    persist();
    renderAll();
    toast(`文件夹「${folder.name}」已移入回收站`);
  });
}

function restoreSingle(id) {
  const note = getNote(id);
  if (!note || !isTrash(note)) return;
  // 若原文件夹已在回收站，先一并还原文件夹（保留结构）
  const folder = getFolderRow(note.folderId);
  if (folder && folder.trashed) {
    const res = restoreFolder(state.folders, state.notes, note.folderId);
    state.folders = res.folders;
    state.notes = res.notes;
  }
  state.notes = restoreNote(state.notes, id);
  state.expanded = note.folderId;
  state.currentId = id;
  persist();
  renderAll();
  toast('已还原笔记');
}

function restoreFolderFlow(folderId) {
  const folder = getFolderRow(folderId);
  if (!folder || !folder.trashed) return;
  const res = restoreFolder(state.folders, state.notes, folderId);
  state.folders = res.folders;
  state.notes = res.notes;
  persist();
  renderAll();
  toast(`已还原文件夹「${folder.name}」`);
}

function purgeFolderFlow(folderId) {
  const folder = getFolderRow(folderId);
  if (!folder || !folder.trashed) return;
  const cnt = state.notes.filter((n) => n.folderId === folderId).length;
  openConfirm({
    title: `彻底删除文件夹「${folder.name}」？`,
    message: `将连同其 ${cnt} 条笔记永久删除，无法恢复。`,
    okText: '彻底删除',
  }).then((ok) => {
    if (!ok) return;
    const res = purgeFolder(state.folders, state.notes, folderId);
    state.folders = res.folders;
    state.notes = res.notes;
    persist();
    renderAll();
    toast('已彻底删除文件夹');
  });
}

function emptyBin() {
  const tF = trashedFolders(state.folders).length;
  const tN = trashedNotes(state.notes).length;
  if (!tF && !tN) return;
  openConfirm({
    title: '清空回收站？',
    message: `将永久删除 ${tF} 个文件夹、${tN} 条笔记，无法恢复。`,
    okText: '清空',
  }).then((ok) => {
    if (!ok) return;
    state.folders = state.folders.filter((f) => !f.trashed);
    state.notes = state.notes.filter((n) => !n.trashed);
    if (currentNote() == null) state.currentId = null;
    clearSelection();
    persist();
    renderAll();
    toast('回收站已清空');
  });
}

// =========================================================
// 新建 / 移动 / 排序
// =========================================================
function contextFolderId() {
  if (state.expanded && state.expanded !== 'all' && state.expanded !== 'bin') {
    const f = getFolderRow(state.expanded);
    if (f && !f.trashed) return state.expanded;
  }
  return state.folders.find((f) => !f.trashed)?.id || null;
}

function newNoteIn(folderId) {
  const target = folderId || contextFolderId() || state.folders[0]?.id;
  const res = createNote(state.notes, { folderId: target });
  state.notes = res.notes;
  state.currentId = res.note.id;
  state.expanded = target;
  state.query = '';
  els.searchInput.value = '';
  clearSelection();
  persist();
  renderAll();
  toast('已新建笔记（自动保存中）');
  els.editor.focus();
}

function newFolderFlow() {
  const res = createFolder(state.folders);
  state.folders = res.folders;
  state.editFolderId = res.folder.id;
  state.expanded = null;
  persist();
  renderSidebar();
  // 聚焦重命名输入
  const input = els.tree.querySelector('[data-rename-input]');
  if (input) { input.focus(); input.select(); }
}

function moveNoteToFolderFlow(noteId, folderId) {
  const note = getNote(noteId);
  const target = getFolderRow(folderId);
  if (!note || !target || target.trashed) return;
  const wasTrash = isTrash(note);
  state.notes = moveNoteToFolder(state.notes, noteId, folderId);
  if (state.selIds.has(noteId)) state.selIds.delete(noteId);
  persist();
  renderAll();
  toast(wasTrash ? `已还原并移动到「${target.name}」` : `已移动到「${target.name}」`);
}

function reorderNotesInFolder(folderId, noteId, orderedNoteIds) {
  state.notes = applyNoteOrder(state.notes, folderId, orderedNoteIds);
  persist();
  renderSidebar();
  toast('已调整笔记顺序（已持久化）');
}

function reorderFolders(orderedIds) {
  state.folders = applyFolderOrder(state.folders, orderedIds);
  persist();
  renderSidebar();
  toast('已调整文件夹顺序（已持久化）');
}

// =========================================================
// 右键上下文菜单
// =========================================================
function buildCtxItems(target) {
  const items = [];
  const trashFolder = target.closest('[data-kind="trash-folder"]');
  if (trashFolder) {
    const fid = trashFolder.dataset.id;
    items.push({ label: '↩️ 还原文件夹', run: () => restoreFolderFlow(fid) });
    items.push({ label: '🗑️ 彻底删除文件夹（连同笔记）', danger: true, run: () => purgeFolderFlow(fid) });
    return items;
  }
  const fRow = target.closest('.folder-row');
  const noteRow = target.closest('.nrow');
  const binRow = target.closest('.bin-row');

  if (fRow && !noteRow) {
    const fid = fRow.dataset.id;
    items.push({ label: '📝 新建笔记（在此文件夹）', run: () => newNoteIn(fid) });
    items.push({ label: '📁 新建文件夹', run: newFolderFlow });
    items.push({ sep: true });
    items.push({ label: '✏️ 重命名', run: () => startRename(fid) });
    items.push({ label: '🗑️ 删除（连同笔记进回收站）', danger: true, run: () => deleteFolderFlow(fid) });
    return items;
  }
  if (noteRow) {
    const id = noteRow.dataset.id;
    const note = getNote(id);
    if (isTrash(note)) {
      items.push({ label: '↩️ 还原（回原文件夹）', run: () => restoreSingle(id) });
      items.push({ label: '🗑️ 彻底删除', danger: true, run: () => deleteSingle(id) });
    } else {
      items.push({ label: '🗑️ 移入回收站', danger: true, run: () => deleteSingle(id) });
    }
    return items;
  }
  if (binRow || target.closest('.bin-wrap')) {
    items.push({ label: '🗑️ 清空回收站', danger: true, run: emptyBin });
    return items;
  }
  // 树区空白：默认创建到当前展开/第一个可用文件夹
  const createTo = contextFolderId();
  items.push({ label: '📝 新建笔记', run: () => newNoteIn(createTo) });
  items.push({ label: '📁 新建文件夹', run: newFolderFlow });
  return items;
}

function startRename(folderId) {
  state.editFolderId = folderId;
  renderSidebar();
  const input = els.tree.querySelector('[data-rename-input]');
  if (input) { input.focus(); input.select(); }
}

function openCtxMenu(x, y, items) {
  els.ctxMenu.innerHTML = items.map((it) => it.sep
    ? '<div class="ctx-sep"></div>'
    : `<button class="ctx-item${it.danger ? ' danger' : ''}">${esc(it.label)}</button>`).join('');
  els.ctxMenu.hidden = false;
  els.ctxMenu.style.left = '0px';
  els.ctxMenu.style.top = '0px';
  const w = els.ctxMenu.offsetWidth;
  const h = els.ctxMenu.offsetHeight;
  els.ctxMenu.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 6)) + 'px';
  els.ctxMenu.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 6)) + 'px';
  // 绑定动作
  const buttons = [...els.ctxMenu.querySelectorAll('.ctx-item')];
  let i = 0;
  for (const item of items) {
    if (item.sep) continue;
    buttons[i].addEventListener('click', () => { hideCtxMenu(); item.run(); });
    i += 1;
  }
}

function hideCtxMenu() {
  els.ctxMenu.hidden = true;
}

// =========================================================
// 拖拽（文件夹排序 / 笔记排序 / 笔记移动 / 笔记拖入回收站）
// =========================================================
const drag = { kind: null, id: null, from: null, trashed: false };

function onDragStart(e) {
  if (e.target.closest('input, textarea, .ctx-menu')) return;
  const row = e.target.closest('.folder-row[draggable="true"], .nrow[draggable="true"]');
  if (!row) return;
  const kind = row.dataset.kind; // folder | note
  const id = row.dataset.id;
  drag.kind = kind;
  drag.id = id;
  drag.trashed = kind === 'note' && row.dataset.trash === '1';
  row.classList.add('dragging');
  try {
    e.dataTransfer.setData('text/plain', JSON.stringify({ kind, id, trashed: drag.trashed }));
    e.dataTransfer.effectAllowed = 'move';
  } catch { /* ignore */ }
}

function clearDropFx() {
  document.querySelectorAll('.drop-target, .ins-before, .ins-after').forEach((el) => el.classList.remove('drop-target', 'ins-before', 'ins-after'));
}

function onDragOver(e) {
  if (!drag.kind) return;
  const row = e.target.closest('.folder-row, .nrow, .bin-row');
  const list = e.target.closest('ul.nlist');
  const listOwner = list ? list.dataset.list : null;

  const allow = () => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };

  if (drag.kind === 'note') {
    if (!row) return;
    if (row.classList.contains('folder-row')) {
      const target = getFolderRow(row.dataset.id);
      const note = getNote(drag.id);
      if (!target || target.trashed || !note) return;
      if (note.folderId !== target.id || drag.trashed) { allow(); row.classList.add('drop-target'); }
      return;
    }
    if (row.classList.contains('bin-row')) {
      if (!drag.trashed) { allow(); row.classList.add('drop-target'); }
      return;
    }
    if (row.classList.contains('nrow') && !drag.trashed) {
      const srcFolder = getNote(drag.id)?.folderId;
      const dstFolder = getNote(row.dataset.id)?.folderId;
      // 仅在“该文件夹自己的列表”内排序（避免跨文件夹/all 视图误排序）
      if (srcFolder && dstFolder && srcFolder === dstFolder && listOwner === srcFolder) {
        allow();
        clearDropFx();
        const r = row.getBoundingClientRect();
        row.classList.add(e.clientY < r.top + r.height / 2 ? 'ins-before' : 'ins-after');
      }
    }
    return;
  }

  if (drag.kind === 'folder') {
    if (!row || !row.classList.contains('folder-row')) return;
    allow();
    clearDropFx();
    const r = row.getBoundingClientRect();
    row.classList.add(e.clientY < r.top + r.height / 2 ? 'ins-before' : 'ins-after');
  }
}

function onDrop(e) {
  if (!drag.kind) return;
  e.preventDefault();
  const row = e.target.closest('.folder-row, .nrow, .bin-row');

  if (drag.kind === 'folder') {
    if (row && row.classList.contains('folder-row')) {
      const rows = [...els.tree.querySelectorAll('.folder-row[draggable="true"]')];
      const from = rows.findIndex((r) => r.dataset.id === drag.id);
      if (from < 0) { clearDropFx(); dragEnd(); return; }
      const order = rows.map((r) => r.dataset.id);
      const toTarget = order.indexOf(row.dataset.id);
      let insertAt = toTarget;
      if (from < toTarget) insertAt = toTarget - 1; // 移除自身后目标前移一位
      if (row.classList.contains('ins-after')) insertAt += 1;
      const list = order.filter((id) => id !== drag.id);
      insertAt = Math.max(0, Math.min(insertAt, list.length));
      list.splice(insertAt, 0, drag.id);
      reorderFolders(list);
    }
  } else if (row) {
    if (row.classList.contains('folder-row')) {
      const targetId = row.dataset.id;
      const target = getFolderRow(targetId);
      const note = getNote(drag.id);
      if (target && !target.trashed && note && (note.folderId !== targetId || drag.trashed)) {
        moveNoteToFolderFlow(drag.id, targetId);
      }
    } else if (row.classList.contains('bin-row')) {
      const note = getNote(drag.id);
      if (note && !note.trashed) {
        state.notes = deleteNotes(state.notes, [drag.id]);
        if (state.currentId === drag.id) pickNeighborAfterRemoval([drag.id]);
        clearSelection();
        persist();
        renderAll();
        toast('已移入回收站');
      }
    } else if (row.classList.contains('nrow')) {
      const srcFolder = getNote(drag.id)?.folderId;
      const dstFolder = getNote(row.dataset.id)?.folderId;
      const listOwner = row.closest('ul.nlist')?.dataset.list;
      if (srcFolder && dstFolder && srcFolder === dstFolder && listOwner === srcFolder && !drag.trashed) {
        const ul = row.closest('ul.nlist');
        const rows = [...ul.querySelectorAll('li.nrow[data-kind="note"]')];
        const ids = rows.map((r) => r.dataset.id).filter((id) => id !== drag.id);
        const srcIndex = rows.findIndex((r) => r.dataset.id === drag.id);
        const dstIndex = rows.findIndex((r) => r.dataset.id === row.dataset.id);
        let insertAt = dstIndex - (srcIndex < dstIndex ? 1 : 0);
        if (row.classList.contains('ins-after')) insertAt += 1;
        ids.splice(Math.max(0, Math.min(insertAt, ids.length)), 0, drag.id);
        reorderNotesInFolder(srcFolder, drag.id, ids);
      }
    }
  }
  clearDropFx();
  dragEnd();
}

function onDragEnd() {
  clearDropFx();
  dragEnd();
}
function dragEnd() {
  drag.kind = null; drag.id = null; drag.trashed = false;
  document.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
}

// =========================================================
// 事件绑定
// =========================================================
function bind() {
  // 顶部按钮
  els.btnNew.addEventListener('click', () => newNoteIn(contextFolderId()));
  els.btnNewFolder.addEventListener('click', newFolderFlow);
  els.btnHelp.addEventListener('click', () => setHelpOpen(true));
  els.helpClose.addEventListener('click', () => setHelpOpen(false));
  els.helpPanel.addEventListener('click', (e) => { if (e.target === els.helpPanel) setHelpOpen(false); });
  els.btnReset.addEventListener('click', onReset);

  // 搜索
  els.searchInput.addEventListener('input', () => { state.query = els.searchInput.value; clearSelection(); renderSidebar(); });
  els.searchClear.addEventListener('click', clearSearch);
  els.searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = els.tree.querySelector('li.nrow[data-kind="note"]');
      if (first) openNote(first.dataset.id);
    }
    if (e.key === 'Escape') { clearSearch(); els.searchInput.blur(); }
  });

  // 树 / 回收站交互（事件委托）
  const sidebarZone = (e) => e.target.closest('#tree, #bin-wrap');
  els.tree.addEventListener('click', (e) => onClickRow(e));
  els.binWrap.addEventListener('click', (e) => onClickRow(e));
  els.tree.addEventListener('change', (e) => { if (e.target.matches('.ncheck')) toggleSelect(e.target.closest('.nrow').dataset.id); });
  els.binWrap.addEventListener('change', (e) => { if (e.target.matches('.ncheck')) toggleSelect(e.target.closest('.nrow').dataset.id); });
  els.tree.addEventListener('dblclick', (e) => {
    const name = e.target.closest('.folder-row .tname');
    if (name) { const fid = name.closest('.folder-row').dataset.id; startRename(fid); }
  });
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('input, textarea')) return;
    const zone = sidebarZone(e);
    if (!zone) return;
    e.preventDefault();
    const items = buildCtxItems(e.target);
    if (items.length) openCtxMenu(e.clientX, e.clientY, items);
  });
  document.addEventListener('click', (e) => {
    if (!els.ctxMenu.hidden && !e.target.closest('.ctx-menu')) hideCtxMenu();
  });
  document.addEventListener('keydown', onGlobalKey);

  // 拖拽
  document.addEventListener('dragstart', onDragStart);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('drop', onDrop);
  document.addEventListener('dragend', onDragEnd);

  // 内容区
  els.titleInput.addEventListener('input', () => {
    const note = currentNote();
    if (!note || note.trashed) return;
    note.title = els.titleInput.value;
    markDirty();
    renderSidebar();
  });
  els.editor.addEventListener('input', () => {
    const note = currentNote();
    if (!note || note.trashed) return;
    note.body = els.editor.value;
    renderPreview();
    markDirty();
  });
  els.preview.addEventListener('change', (e) => {
    const cb = e.target;
    if (!cb.matches('input[type="checkbox"][data-offset]')) return;
    const note = currentNote();
    if (!note || note.trashed) return;
    const next = toggleTask(note.body, Number(cb.dataset.offset));
    if (next !== note.body) {
      note.body = next;
      els.editor.value = next;
      renderPreview();
      markDirty();
      flushSave(false);
    }
  });
  els.modeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (btn) setMode(btn.dataset.mode);
  });

  els.btnRestore.addEventListener('click', () => { const n = currentNote(); if (n) restoreSingle(n.id); });
  els.btnDelete.addEventListener('click', () => { const n = currentNote(); if (n) deleteSingle(n.id); });

  // 靠边隐藏
  els.dockToggle.addEventListener('click', toggleDock);
  els.dockBar.addEventListener('mouseenter', () => { if (state.docked) peekDock(); });
  const shell = document.getElementById('shell');
  shell.addEventListener('mouseenter', () => { if (state.peeked) clearTimeout(state.dockTimer); });
  shell.addEventListener('mouseleave', () => { if (state.docked && state.peeked) scheduleReDock(); });

  // 标题栏假按钮
  document.querySelectorAll('.fb-min, .fb-max, .fb-close').forEach((b) => {
    b.addEventListener('click', () => toast('这是演示模式，没有真实窗口；可像普通网页一样使用浏览器标签页。'));
  });
}

// 点击树 / 回收站行
function onClickRow(e) {
  const actBtn = e.target.closest('[data-act]');
  if (actBtn) {
    const act = actBtn.dataset.act;
    if (act === 'folder-del') { deleteFolderFlow(actBtn.dataset.id); return; }
    if (act === 'toggle-multi') {
      state.multi = !state.multi;
      if (!state.multi && state.selIds.size) { state.selIds.clear(); }
      renderSidebar();
      return;
    }
    if (act === 'batch-del') {
      if (state.selIds.size) trashNotesFlow([...state.selIds]);
      return;
    }
    if (act === 'empty-bin') { emptyBin(); return; }
    return;
  }
  const row = e.target.closest('.trow, .nrow');
  if (!row) return;
  const kind = row.dataset.kind;

  if (row.classList.contains('nrow') || kind === 'note' || kind === 'trash-folder') {
    if (e.target.closest('.ncheck')) return; // checkbox change 处理
    const id = row.dataset.id;
    if (e.ctrlKey || e.metaKey || state.multi) {
      if (!state.multi) state.multi = true;
      toggleSelect(id);
    } else if (kind === 'trash-folder') {
      // 点击回收站中的文件夹行暂不打开内容
    } else {
      openNote(id);
    }
    return;
  }
  if (row.classList.contains('trow')) {
    if (kind === 'all' || kind === 'folder') expandKey(row.dataset.id);
    else if (kind === 'bin') expandKey('bin');
  }
}

// 重命名输入相关事件已在 bindDynamicInputs 处理

// =========================================================
// 自动保存
// =========================================================
function markDirty() {
  state.dirty = true;
  els.saveStatus.textContent = '保存中…';
  els.saveStatus.className = 'save-status saving';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => flushSave(false), 700);
}

function flushSave(showToastMsg) {
  clearTimeout(state.saveTimer);
  const note = currentNote();
  if (note && state.dirty && !note.trashed) {
    state.notes = updateNote(state.notes, note.id, { title: note.title, body: note.body });
  }
  state.dirty = false;
  persist();
  const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  els.saveStatus.textContent = `已保存 ${now}`;
  els.saveStatus.className = 'save-status saved';
  renderSidebar();
  renderStatus();
  if (showToastMsg) toast('已保存');
}

// =========================================================
// 视图模式 / 帮助 / 模态 / Toast
// =========================================================
function setMode(mode) {
  state.mode = mode;
  els.workspace.className = 'workspace mode-' + mode;
  els.modeSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  if (mode === 'edit') els.editor.focus();
}

function setHelpOpen(open) { els.helpPanel.hidden = !open; }

let modalResolver = null;
function openConfirm({ title, message, okText = '确定' }) {
  els.modalTitle.textContent = title;
  els.modalMessage.textContent = message;
  els.modalOk.textContent = okText;
  els.modalMask.hidden = false;
  return new Promise((resolve) => { modalResolver = resolve; });
}
function closeModal(result) {
  if (els.modalMask.hidden) return;
  els.modalMask.hidden = true;
  if (modalResolver) { modalResolver(result); modalResolver = null; }
}
els.modalOk.addEventListener('click', () => closeModal(true));
els.modalCancel.addEventListener('click', () => closeModal(false));
els.modalMask.addEventListener('click', (e) => { if (e.target === els.modalMask) closeModal(false); });

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  els.toasts.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, 2000);
}

// =========================================================
// 靠边隐藏（模拟）
// =========================================================
function toggleDock() {
  if (state.docked || state.peeked) {
    undock();
  } else {
    dock();
  }
}
function dock() {
  state.docked = true;
  state.peeked = false;
  clearTimeout(state.dockTimer);
  document.body.classList.add('dock-on');
  document.body.classList.remove('dock-peek');
  els.dockToggle.textContent = '⇱';
  toast('已靠边隐藏（模拟）：悬停右侧窄条展开，移开鼠标自动收回');
}
function undock() {
  state.docked = false;
  state.peeked = false;
  clearTimeout(state.dockTimer);
  document.body.classList.remove('dock-on', 'dock-peek');
  els.dockToggle.textContent = '⤢';
}
function peekDock() {
  if (!state.docked) return;
  state.peeked = true;
  document.body.classList.add('dock-peek');
  scheduleReDock();
}
function scheduleReDock() {
  clearTimeout(state.dockTimer);
  state.dockTimer = setTimeout(() => {
    if (state.docked && state.peeked) {
      state.peeked = false;
      document.body.classList.remove('dock-peek');
    }
  }, 2400);
}

// =========================================================
// 快捷键
// =========================================================
function onGlobalKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  const active = document.activeElement;
  const typing = active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT');

  if (e.key === 'Escape') {
    if (!els.ctxMenu.hidden) { hideCtxMenu(); return; }
    if (!els.modalMask.hidden) { closeModal(false); return; }
    if (!els.helpPanel.hidden) { setHelpOpen(false); return; }
    if (state.editFolderId) { state.editFolderId = null; renderSidebar(); return; }
    if (active === els.searchInput && q()) { clearSearch(); return; }
    if (active === els.searchInput) active.blur();
    return;
  }
  if (e.key === '?' && !mod && !e.altKey && !typing) {
    setHelpOpen(els.helpPanel.hidden);
    return;
  }
  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    els.searchInput.focus(); els.searchInput.select();
    return;
  }
  if (e.altKey && !mod && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    newNoteIn(contextFolderId());
    return;
  }
  if (e.altKey && !e.ctrlKey && (e.key === '`' || e.code === 'Backquote')) {
    e.preventDefault();
    toggleDock();
    return;
  }
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    flushSave(true);
    return;
  }
}

// =========================================================
// 搜索 / 重置
// =========================================================
function clearSearch() {
  state.query = '';
  els.searchInput.value = '';
  clearSelection();
  renderSidebar();
}

function onReset() {
  openConfirm({
    title: '重置演示数据？',
    message: '将清空 IndexedDB / localStorage 中的本地数据，恢复为示例文件夹与笔记。',
    okText: '重置',
  }).then(async (ok) => {
    if (!ok) return;
    await dbClear();
    clearSavedLocal();
    const seed = defaultSeed();
    state.folders = seed.folders;
    state.notes = seed.notes;
    const af = activeFolders(state.folders);
    state.expanded = af.length ? af[0].id : 'all';
    const first = af.length ? notesOfFolder(state.notes, af[0].id)[0] : null;
    state.currentId = first ? first.id : null;
    clearSelection();
    els.searchInput.value = '';
    state.query = '';
    persist();
    renderAll();
    toast('已恢复示例数据');
  });
}

boot();
