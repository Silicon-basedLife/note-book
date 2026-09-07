<script lang="ts">
  // App.svelte —— NoteApp P0 主窗口（三栏：文件夹 / 笔记列表 / 编辑+预览）
  // 行为依据 docs/ROADMAP.md P0；数据一律经 NoteCore（core-client）读写，本文件只做 UI 编排。
  import { onMount } from 'svelte';
  import { createCore, displayTitle, excerptOf } from '../shared/core-client.ts';
  import { renderMarkdown } from '../lib/core/markdown.ts';
  import { plainTextOf } from '../lib/core/index.ts';
  import { relativeTime } from '../lib/core/format.ts';
  import { ActionRegistry, type ActionDef, type Shortcut } from '../lib/core/actions.ts';
  import type { NoteCore } from '../lib/core/store.ts';
  import type { NoteDoc, SearchHit } from '../lib/core/types.ts';

  const AUTO_SAVE_MS = 600;

  // ---------- 类型 ----------
  interface ListItem {
    id: string;
    folder: string;
    title: string;
    updatedAt: string;
    excerpt?: string;
    snippet?: string;
    where?: 'title' | 'body';
    hit?: boolean;
  }
  interface ToastItem { id: number; text: string }
  interface ConfirmState {
    title: string;
    message: string;
    okLabel?: string;
    onOk: () => void | Promise<void>;
  }
  interface PromptState {
    title: string;
    placeholder?: string;
    value: string;
    onOk: (v: string) => void | Promise<void>;
  }

  // ---------- 全局状态 ----------
  let core: NoteCore;
  let ready = $state(false);
  let folders = $state<string[]>([]);
  let counts = $state<Record<string, number>>({});
  let activeFolder = $state<string | null>(null); // null = 全部
  let query = $state('');
  let mode = $state<'edit' | 'split' | 'preview'>('split');
  let listItems = $state<ListItem[]>([]);
  let currentId = $state<string | null>(null);
  let current = $state<{ id: string; title: string; body: string; folder: string; updatedAt: string } | null>(null);
  let saveState = $state<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  let lastSavedAt = $state<string | null>(null);
  let toasts = $state<ToastItem[]>([]);
  let confirm = $state<ConfirmState | null>(null);
  let prompt = $state<PromptState | null>(null);
  let helpOpen = $state(false);
  let renamingFolder = $state<string | null>(null);
  let renameValue = $state('');
  let searchEl = $state<HTMLInputElement | null>(null);
  let previewEl = $state<HTMLElement | null>(null);
  const registry = new ActionRegistry();

  // ---------- 计算 ----------
  const previewRender = $derived(
    mode !== 'edit' && current
      ? renderMarkdown(current.body)
      : null
  );
  const previewTasks = $derived(previewRender?.tasks ?? []);
  const totalNotes = $derived(Object.values(counts).reduce((a, b) => a + b, 0));

  // ---------- 通用 ----------
  function toast(text: string) {
    const id = Date.now() + Math.floor(Math.random() * 1e4);
    toasts = [...toasts, { id, text }];
    setTimeout(() => {
      toasts = toasts.filter((t) => t.id !== id);
    }, 2400);
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

  // ---------- 保存（去抖自动保存；写队列串行化避免旧快照覆盖新正文） ----------
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
    if (!id) { saveState = 'saved'; return; }
    saveState = 'saving';
    try {
      const doc = await core.updateNote(id, { title, body });
      if (doc && current && current.id === id) {
        current.updatedAt = doc.updatedAt;
        // 保存期间又有新输入时保持“未保存”，交由新定时器再次落盘
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
    saveState = 'dirty';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      scheduleSave();
    }, AUTO_SAVE_MS);
  }

  /** 立即把待保存内容按顺序落盘（切换笔记 / 勾选待办 / Ctrl+S / 失焦时调用） */
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
    const q = query.trim();
    if (q) {
      const hits: SearchHit[] = core.search(q, activeFolder) ?? [];
      listItems = hits.map((h) => ({
        id: h.noteId,
        folder: h.folder,
        title: h.title.trim() === '' ? '无标题笔记' : h.title,
        updatedAt: h.updatedAt,
        snippet: h.snippet,
        where: h.where,
        hit: true,
      }));
    } else {
      const notes: NoteDoc[] = core.listNotes(activeFolder);
      listItems = notes.map((n) => ({
        id: n.id,
        folder: n.folder,
        title: displayTitle(n),
        updatedAt: n.updatedAt,
        excerpt: n.body ? excerptOf(plainTextOf(n.body)) : '',
      }));
    }
    // 当前笔记的持久化时间展示（不覆盖编辑中的标题/正文）
    if (currentId) {
      const doc = core.getNote(currentId);
      if (doc && current) {
        current.updatedAt = doc.updatedAt;
        current.folder = doc.folder;
      } else if (!doc) {
        currentId = null;
        current = null;
      }
    }
  }

  // ---------- 笔记操作 ----------
  async function openNote(id: string) {
    if (currentId === id && current) { saveState = 'saved'; return; }
    await flush();
    const doc = core.getNote(id);
    if (!doc) return;
    currentId = id;
    current = { id: doc.id, title: doc.title, body: doc.body, folder: doc.folder, updatedAt: doc.updatedAt };
    saveState = 'saved';
    lastSavedAt = null;
  }

  async function newNote(targetFolder?: string) {
    await flush();
    const folder = targetFolder ?? activeFolder ?? folders[0] ?? '收件箱';
    const doc = await core.createNote({ folder, title: '', body: '' });
    currentId = doc.id;
    current = { id: doc.id, title: '', body: '', folder: doc.folder, updatedAt: doc.updatedAt };
    saveState = 'saved';
    refresh();
    requestAnimationFrame(() => editorRef?.focus());
  }

  function deleteNoteFlow() {
    if (!current) return;
    const t = displayTitle(current);
    confirm = {
      title: '删除笔记',
      message: `确定删除「${t}」吗？对应的本地文件将被移除，此操作不可撤销。`,
      okLabel: '删除',
      onOk: async () => {
        const id = currentId;
        confirm = null;
        if (!id) return;
        await core.deleteNote(id);
        refresh();
        const first = listItems[0];
        if (first) await openNote(first.id);
        else { currentId = null; current = null; }
      },
    };
  }

  // ---------- 编辑输入 ----------
  function onTitleInput(e: Event) {
    if (!current) return;
    current.title = (e.target as HTMLInputElement).value;
    markDirty();
  }
  function onBodyInput(e: Event) {
    if (!current) return;
    current.body = (e.target as HTMLTextAreaElement).value;
    markDirty();
  }

  async function onFolderChange(v: string) {
    if (!current) return;
    await flush();
    if (current.folder === v) return;
    const doc = await core.updateNote(current.id, { folder: v });
    if (doc) {
      current.folder = doc.folder;
      refresh();
    }
  }

  async function onPreviewClick(e: MouseEvent) {
    const el = e.target as HTMLElement;
    const box = el.closest?.('input.task-check') as HTMLInputElement | null;
    if (!box || !current) return;
    const offset = Number(box.dataset.offset);
    if (!Number.isInteger(offset)) return;
    // 先落盘当前草稿，保证渲染偏移与持久化正文一致，再勾选回写
    await flush();
    const ok = await core.toggleTask(current.id, offset);
    if (ok) {
      const doc = core.getNote(current.id);
      if (doc) { current.body = doc.body; current.updatedAt = doc.updatedAt; }
      saveState = 'saved';
      refresh();
    }
  }

  // ---------- 文件夹操作 ----------
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

  function deleteFolderFlow(name: string) {
    confirm = {
      title: '删除文件夹',
      message: `删除文件夹「${name}」后，其中笔记将移入「收件箱」。确定继续吗？`,
      okLabel: '删除',
      onOk: async () => {
        confirm = null;
        const r = await core.deleteFolder(name);
        if (!r.ok) { toast(r.reason ?? '删除失败'); return; }
        if (activeFolder === name) activeFolder = null;
        refresh();
      },
    };
  }

  function startRenameFolder(name: string) {
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

  // ---------- 视图 / 选择 ----------
  function selectFolder(folder: string | null) {
    activeFolder = folder;
    refresh();
  }
  function onSearchInput(v: string) {
    query = v;
    refresh();
  }

  // ---------- 快捷键 ----------
  function registerActions() {
    registry.register({ id: 'new-note', label: '新建笔记', shortcut: { key: 'n', alt: true }, run: () => { if (ready) void newNote(); } });
    registry.register({ id: 'focus-search', label: '聚焦搜索', shortcut: { key: 'k', ctrl: true }, run: () => { if (ready) searchEl?.focus(); } });
    registry.register({ id: 'save-now', label: '立即保存', shortcut: { key: 's', ctrl: true }, run: () => { if (ready) void flush(); } });
    registry.register({ id: 'help', label: '快捷键帮助', shortcut: { key: '?', shift: true }, run: () => { helpOpen = !helpOpen; } });
  }

  function onGlobalKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && prompt) {
      const value = prompt.value.trim();
      prompt.onOk(value);
      return;
    }
    if (e.key === 'Escape') {
      if (helpOpen) { helpOpen = false; return; }
      if (prompt) { prompt = null; return; }
      if (confirm) { confirm = null; return; }
      if (renamingFolder) { renamingFolder = null; return; }
      return;
    }
    const action = registry.match(e);
    if (!action) return;
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const mods = action.shortcut;
    // 输入态只放行带修饰键的动作，避免吞掉正文按键
    if (typing && !(mods?.ctrl || mods?.alt || mods?.meta)) return;
    e.preventDefault();
    action.run();
  }

  // ---------- 其它 ----------
  let editorRef: HTMLTextAreaElement | undefined = $state();
  let renameInput: HTMLInputElement | undefined = $state();

  async function onDeleteKeyHandler() { /* 占位：删除仅通过按钮确认 */ }

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
      if (listItems[0]) await openNote(listItems[0].id);
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
    <!-- 左：文件夹 / 导航 -->
    <aside class="sidebar">
      <div class="sb-brand">
        <span class="logo">N</span>
        <div class="sb-brand-text"><strong>NoteApp</strong><small>本地 Markdown 笔记</small></div>
      </div>

      <button class="btn-primary" onclick={() => void newNote()}>＋ 新建笔记</button>

      <div class="nav-scroll">
        <p class="nav-label">笔记</p>
        <button
          class="nav-item" class:active={activeFolder === null && !query}
          onclick={() => selectFolder(null)}
        >
          <span class="nav-ico">🗂️</span>全部笔记
          <span class="nav-count">{totalNotes}</span>
        </button>

        <div class="nav-label-row">
          <p class="nav-label">文件夹</p>
          <button class="btn-icon" title="新建文件夹" onclick={newFolderFlow}>＋</button>
        </div>
        <div id="folder-list">
          {#each folders as folder (folder)}
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
                />
              </div>
            {:else}
              <div
                class="nav-item folder-item"
                class:active={activeFolder === folder && !query}
                ondblclick={() => startRenameFolder(folder)}
                role="button"
                tabindex="-1"
              >
                <button class="folder-main" onclick={() => selectFolder(folder)}>
                  <span class="nav-ico">📁</span><span class="folder-name">{folder}</span>
                  <span class="nav-count">{counts[folder] ?? 0}</span>
                </button>
                {#if folder !== '收件箱'}
                  <button class="folder-del" title="删除文件夹" onclick={() => deleteFolderFlow(folder)}>✕</button>
                {/if}
              </div>
            {/if}
          {/each}
        </div>
      </div>

      <div class="sb-foot">
        <button class="btn-ghost" onclick={() => (helpOpen = true)}>⌨️ 快捷键</button>
        <span class="sb-storage">存储：本机（IndexedDB）</span>
      </div>
    </aside>

    <!-- 中：搜索 + 笔记列表 -->
    <section class="list-pane">
      <div class="list-head">
        <h2>{activeFolder ?? '全部笔记'}</h2>
        <span class="list-sub">{query ? '搜索结果' : '按更新时间排序'}</span>
      </div>
      <div class="searchbox">
        <span class="search-ico">🔍</span>
        <input
          bind:this={searchEl}
          type="text"
          placeholder="搜索标题与正文…（Ctrl+K）"
          value={query}
          oninput={(e) => onSearchInput((e.target as HTMLInputElement).value)}
          autocomplete="off"
          spellcheck="false"
        />
        {#if query}
          <button class="search-clear" title="清空搜索" onclick={() => onSearchInput('')}>✕</button>
        {/if}
      </div>
      <div class="note-list">
        {#if listItems.length === 0}
          <div class="list-empty">
            {query ? '没有匹配的笔记' : '这个文件夹还没有笔记'}
          </div>
        {:else}
          {#each listItems as item (item.id)}
            <button
              class="note-row" class:active={item.id === currentId}
              onclick={() => void openNote(item.id)}
            >
              <span class="note-title">{item.title}</span>
              {#if item.hit}
                <span class="note-snippet">{@html item.snippet}</span>
                <span class="note-meta">
                  {item.where === 'title' ? '标题命中' : '正文命中'} · {relativeTime(item.updatedAt)}
                </span>
              {:else if item.excerpt}
                <span class="note-excerpt">{item.excerpt}</span>
                <span class="note-meta">{item.folder} · {relativeTime(item.updatedAt)}</span>
              {:else}
                <span class="note-meta">{item.folder} · {relativeTime(item.updatedAt)}</span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    </section>

    <!-- 右：编辑器 + 预览 -->
    <section class="editor-pane">
      {#if current}
        <div class="ed-toolbar">
          <div class="ed-left">
            <select
              class="folder-chip" title="移动笔记到文件夹"
              value={current.folder}
              onchange={(e) => void onFolderChange((e.target as HTMLSelectElement).value)}
            >
              {#each folders as folder (folder)}
                <option value={folder}>{folder}</option>
              {/each}
            </select>
            <input
              class="title-input" type="text" placeholder="无标题笔记…" spellcheck="false"
              value={current.title}
              oninput={onTitleInput}
            />
          </div>
          <div class="ed-right">
            <div class="seg" id="mode-seg">
              <button class:active={mode === 'edit'} onclick={() => (mode = 'edit')}>编辑</button>
              <button class:active={mode === 'split'} onclick={() => (mode = 'split')}>分屏</button>
              <button class:active={mode === 'preview'} onclick={() => (mode = 'preview')}>预览</button>
            </div>
            <span class="save-status" class:saving={saveState === 'saving'} class:dirty={saveState === 'dirty'}>
              {saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '未保存' : saveState === 'saved' && lastSavedAt ? `已保存 ${relativeTime(lastSavedAt)}` : '已保存'}
            </span>
            <button class="btn-danger" onclick={deleteNoteFlow} title="删除当前笔记">删除</button>
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
              oninput={onBodyInput}
            ></textarea>
          {/if}
          {#if mode !== 'edit'}
            <div
              class="preview" id="preview"
              bind:this={previewEl}
              onclick={onPreviewClick}
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

<!-- 快捷键帮助 -->
{#if helpOpen}
  <div
    class="overlay"
    role="button" tabindex="-1" aria-label="关闭快捷键帮助"
    onclick={(e) => { if (e.target === e.currentTarget) helpOpen = false; }}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') { e.preventDefault(); helpOpen = false; } }}
  >
    <div class="panel help-card">
      <h3>⌨️ 快捷键</h3>
      <table>
        {#each registry.list() as def}
          <tr>
            <td><kbd>{displayShortcut(def)}</kbd></td>
            <td>{def.label}</td>
          </tr>
        {/each}
      </table>
      <p class="help-note">
        提示：输入即自动保存（去抖）；「Esc」关闭弹层；双击文件夹名可重命名（收件箱除外）。
        Web 演示中的快捷键仅在应用窗口内生效，桌面版（P1）将支持全局热键与托盘悬浮窗。
      </p>
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
        <button class="btn-danger" onclick={() => confirm?.onOk()}>{confirm.okLabel ?? '确定'}</button>
      </div>
    </div>
  </div>
{/if}

<!-- 输入对话框（新建文件夹） -->
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
        <button class="btn-primary" onclick={() => prompt?.onOk(prompt.value)}>创建</button>
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
