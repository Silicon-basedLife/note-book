// app.mjs —— 演示界面交互（纯前端，数据模拟）
import {
  FOLDERS, defaultSeed, createNote, updateNote, deleteNote, toggleTask,
  sortByUpdated, folderCounts, searchNotes, plainTextOf, relativeTime,
  loadSaved, saveState, clearSaved,
} from './store.mjs';
import { renderMarkdown } from './markdown.mjs';

const $ = (id) => document.getElementById(id);

const els = {
  btnNew: $('btn-new'),
  btnHelp: $('btn-help'),
  btnReset: $('btn-reset'),
  helpClose: $('help-close'),
  helpPanel: $('help-panel'),
  modalMask: $('modal-mask'),
  modalTitle: $('modal-title'),
  modalMessage: $('modal-message'),
  modalOk: $('modal-ok'),
  modalCancel: $('modal-cancel'),
  folderList: $('folder-list'),
  noteList: $('note-list'),
  searchInput: $('search-input'),
  searchClear: $('search-clear'),
  listTitle: $('list-title'),
  listSub: $('list-sub'),
  editorFolder: $('editor-folder'),
  titleInput: $('title-input'),
  saveStatus: $('save-status'),
  btnDelete: $('btn-delete'),
  modeSeg: $('mode-seg'),
  workspace: $('workspace'),
  editor: $('editor'),
  preview: $('preview'),
  emptyEditor: $('empty-editor'),
  statusNotes: $('status-notes'),
  toasts: $('toasts'),
};

// ---------- 状态 ----------
const state = {
  notes: [],
  filter: { type: 'all', value: null }, // all | folder
  query: '',
  selectedId: null,
  mode: 'split',
  dirty: false,
  saveTimer: null,
};

const currentNote = () => state.notes.find((n) => n.id === state.selectedId) || null;

// ---------- 启动 ----------
function boot() {
  const notes = loadSaved(() => sortByUpdated(defaultSeed()));
  state.notes = sortByUpdated(notes);
  state.selectedId = state.notes[0] ? state.notes[0].id : null;
  bind();
  renderAll();
}

// ---------- 事件绑定 ----------
function bind() {
  els.btnNew.addEventListener('click', onNewNote);
  els.btnHelp.addEventListener('click', () => setHelpOpen(true));
  els.helpClose.addEventListener('click', () => setHelpOpen(false));
  els.helpPanel.addEventListener('click', (e) => { if (e.target === els.helpPanel) setHelpOpen(false); });
  els.btnReset.addEventListener('click', onReset);

  els.searchInput.addEventListener('input', () => {
    state.query = els.searchInput.value;
    renderList();
  });
  els.searchClear.addEventListener('click', clearSearch);
  els.noteList.addEventListener('click', (e) => {
    const item = e.target.closest('.note-item');
    if (item) selectNote(item.dataset.id);
  });

  els.titleInput.addEventListener('input', () => {
    const note = currentNote();
    if (!note) return;
    note.title = els.titleInput.value;
    markDirty();
    renderList(); // 标题即时反映到列表
  });

  els.editor.addEventListener('input', () => {
    const note = currentNote();
    if (!note) return;
    note.body = els.editor.value;
    renderPreview();
    markDirty();
  });

  els.preview.addEventListener('change', (e) => {
    const cb = e.target;
    if (!cb.matches('input[type="checkbox"][data-offset]')) return;
    const note = currentNote();
    if (!note) return;
    const offset = Number(cb.dataset.offset);
    const next = toggleTask(note.body, offset);
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
    if (!btn) return;
    setMode(btn.dataset.mode);
  });

  els.btnDelete.addEventListener('click', onDeleteNote);

  // 标题栏假按钮（演示）
  document.querySelectorAll('.fb-min, .fb-max, .fb-close').forEach((b) => {
    b.addEventListener('click', () => toast('这是演示模式，没有真实窗口；可像普通网页一样使用浏览器标签页。'));
  });

  window.addEventListener('keydown', onKeydown);
}

// ---------- 渲染 ----------
function renderAll() {
  renderNav();
  renderList();
  renderEditor();
  renderStatus();
}

function renderNav() {
  const counts = folderCounts(state.notes);
  const allBtn = document.querySelector('.nav-item[data-type="all"]');
  if (allBtn) {
    allBtn.classList.toggle('active', state.filter.type === 'all' && !state.query);
    const c = allBtn.querySelector('.nav-count');
    if (c) c.textContent = state.notes.length;
  }

  const html = FOLDERS.map((f) => {
    const active = state.filter.type === 'folder' && state.filter.value === f && !state.query;
    return `<button class="nav-item${active ? ' active' : ''}" data-type="folder" data-value="${f}">
      <span class="nav-ico">📁</span>${f} <span class="nav-count">${counts[f] || 0}</span>
    </button>`;
  }).join('');
  els.folderList.innerHTML = html;
  els.folderList.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => onNavClick('folder', btn.dataset.value));
  });
  const allActive = document.querySelector('.nav-item[data-type="all"]');
  if (allActive) allActive.addEventListener('click', () => onNavClick('all'));
}

function visibleNotes() {
  const q = state.query.trim();
  if (q) {
    const results = searchNotes(state.notes, q) || [];
    return results.map((r) => ({ note: r.note, snippet: r.snippet }));
  }
  if (state.filter.type === 'folder') {
    const list = state.notes.filter((n) => n.folder === state.filter.value);
    return list.map((n) => ({ note: n, snippet: null }));
  }
  return state.notes.map((n) => ({ note: n, snippet: null }));
}

function renderList() {
  const vis = visibleNotes();
  const q = state.query.trim();

  if (state.filter.type === 'folder' && !q) {
    els.listTitle.textContent = state.filter.value;
    els.listSub.textContent = `${vis.length} 条笔记 · 按更新时间排序`;
  } else if (q) {
    els.listTitle.textContent = '搜索结果';
    els.listSub.textContent = `“${q}” · ${vis.length} 条结果`;
  } else {
    els.listTitle.textContent = '全部笔记';
    els.listSub.textContent = `${vis.length} 条笔记 · 按更新时间排序`;
  }

  els.noteList.innerHTML = '';
  if (vis.length === 0) {
    const div = document.createElement('div');
    div.className = 'list-empty';
    div.textContent = q ? `没有匹配「${q}」的笔记` : '这个文件夹还没有笔记。';
    els.noteList.appendChild(div);
    return;
  }

  for (const { note, snippet } of vis) {
    const item = document.createElement('div');
    item.className = 'note-item' + (note.id === state.selectedId ? ' active' : '');
    item.dataset.id = note.id;

    const title = document.createElement('div');
    title.className = 'note-item-title';
    title.textContent = note.title || '（无标题笔记）';
    item.appendChild(title);

    if (snippet) {
      const s = document.createElement('div');
      s.className = 'note-item-snip';
      s.innerHTML = snippet; // snippet 由 store 内部转义后加 <mark>
      item.appendChild(s);
    } else {
      const text = plainTextOf(note.body);
      if (text) {
        const s = document.createElement('div');
        s.className = 'note-item-snip';
        s.textContent = text.length > 60 ? text.slice(0, 60) + '…' : text;
        item.appendChild(s);
      }
    }

    const meta = document.createElement('div');
    meta.className = 'note-item-meta';
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = note.folder;
    const time = document.createElement('span');
    time.textContent = relativeTime(note.updatedAt);
    meta.append(chip, time);
    item.appendChild(meta);

    els.noteList.appendChild(item);
  }
}

function renderEditor() {
  const note = currentNote();
  const has = !!note;
  els.titleInput.value = has ? note.title : '';
  els.editor.value = has ? note.body : '';
  els.editorFolder.textContent = has ? note.folder : '—';
  els.btnDelete.disabled = !has;
  els.titleInput.disabled = !has;
  els.editor.disabled = !has;
  els.emptyEditor.hidden = has;
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
  els.statusNotes.textContent = `${state.notes.length} 条笔记`;
}

// ---------- 操作 ----------
function onNavClick(type, value) {
  state.filter = { type, value: value || null };
  clearSearch();
  renderAll();
}

function selectNote(id) {
  if (!state.notes.some((n) => n.id === id)) return;
  state.selectedId = id;
  renderEditor();
  renderList(); // 高亮更新
}

function onNewNote() {
  const folder = state.filter.type === 'folder' ? state.filter.value : '收件箱';
  const res = createNote(state.notes, { folder, title: '无标题笔记', body: '' });
  state.notes = res.notes;
  state.selectedId = res.note.id;
  state.query = '';
  els.searchInput.value = '';
  state.filter = { type: 'folder', value: folder };
  saveState(state.notes);
  renderAll();
  toast(`已新建笔记（文件夹：${folder}）`);
  els.editor.focus();
}

function onDeleteNote() {
  const note = currentNote();
  if (!note) return;
  openConfirm({
    title: '删除这条笔记？',
    message: `“${note.title || '无标题笔记'}”删除后不可恢复（演示环境仅删除本地数据）。`,
    okText: '删除',
  }).then((ok) => {
    if (!ok) return;
    const visIds = visibleNotes().map((v) => v.note.id);
    const idx = visIds.indexOf(note.id);
    state.notes = deleteNote(state.notes, note.id);
    const next = visIds[idx + 1] || visIds[idx - 1];
    state.selectedId = next && state.notes.some((n) => n.id === next) ? next : null;
    saveState(state.notes);
    renderAll();
    toast('已删除笔记');
  });
}

function onReset() {
  openConfirm({
    title: '重置演示数据？',
    message: '将清空浏览器里保存的本地数据，恢复为 8 条示例笔记。',
    okText: '重置',
  }).then((ok) => {
    if (!ok) return;
    clearSaved();
    state.notes = sortByUpdated(defaultSeed());
    state.selectedId = state.notes[0].id;
    state.query = '';
    els.searchInput.value = '';
    state.filter = { type: 'all', value: null };
    renderAll();
    toast('已恢复示例数据');
  });
}

// ---------- 自动保存 ----------
function markDirty() {
  state.dirty = true;
  els.saveStatus.textContent = '保存中…';
  els.saveStatus.className = 'save-status saving';
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => flushSave(true), 700);
}

function flushSave(showToastMsg) {
  clearTimeout(state.saveTimer);
  const note = currentNote();
  if (note && state.dirty) {
    state.notes = updateNote(state.notes, note.id, { title: note.title, body: note.body });
  }
  state.dirty = false;
  saveState(state.notes);
  const now = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  els.saveStatus.textContent = `已保存 ${now}`;
  els.saveStatus.className = 'save-status saved';
  renderList();
  renderStatus();
  if (showToastMsg) toast('已保存');
}

// ---------- 搜索 ----------
function clearSearch() {
  state.query = '';
  els.searchInput.value = '';
  renderList();
  renderNav();
}

// ---------- 视图模式 ----------
function setMode(mode) {
  state.mode = mode;
  els.workspace.className = 'workspace mode-' + mode;
  els.modeSeg.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  if (mode === 'edit') els.editor.focus();
}

// ---------- 帮助 ----------
function setHelpOpen(open) {
  els.helpPanel.hidden = !open;
}

// ---------- 确认对话框 ----------
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

// ---------- Toast ----------
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  els.toasts.appendChild(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 220);
  }, 2000);
}

// ---------- 快捷键 ----------
function isTypingTarget(el) {
  return el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT');
}

function onKeydown(e) {
  const mod = e.ctrlKey || e.metaKey;
  const active = document.activeElement;

  if (e.key === 'Escape') {
    if (!els.modalMask.hidden) { closeModal(false); return; }
    if (!els.helpPanel.hidden) { setHelpOpen(false); return; }
    if (active === els.searchInput && state.query) { clearSearch(); }
    if (active === els.searchInput) { active.blur(); }
    return;
  }

  if (e.key === '?' && !mod && !isTypingTarget(active) && !e.altKey) {
    setHelpOpen(els.helpPanel.hidden);
    return;
  }

  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    els.searchInput.focus();
    els.searchInput.select();
    return;
  }
  if (e.altKey && !mod && e.key.toLowerCase() === 'n') {
    e.preventDefault();
    onNewNote();
    return;
  }
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    flushSave(true);
    return;
  }
}

// ---------- 入口 ----------
boot();
