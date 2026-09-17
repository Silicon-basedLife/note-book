<script lang="ts">
  // Settings.svelte —— 独立设置窗口（通用 / 快捷键 / 存储 / 编辑器 / 窗口与吸附 / 关于）
  import { onMount } from 'svelte';
  import {
    DEFAULT_SETTINGS,
    AUTO_SAVE_RANGE,
    HIDE_DELAY_RANGE,
    HOT_ZONE_RANGE,
    type AppSettings,
    type Shortcut,
  } from '../lib/settings/types.ts';
  import { ACTIONS } from '../lib/settings/catalog.ts';
  import {
    effectiveShortcuts,
    findShortcutConflict,
    formatShortcut,
    isShortcutAllowed,
  } from '../lib/settings/shortcuts.ts';
  import { loadSettings, saveSettings, subscribeSettings } from '../lib/settings/store.ts';
  import {
    getStorageInfo,
    migrateNotes,
    openPath,
    pickFolder,
    storageAdminAvailable,
    type StorageInfo,
  } from '../lib/settings/storage-admin.ts';

  type Tab = 'general' | 'shortcuts' | 'storage' | 'editor' | 'dock' | 'about';
  const TABS: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'general', label: '通用', icon: '⚙️' },
    { id: 'shortcuts', label: '快捷键', icon: '⌨️' },
    { id: 'storage', label: '存储', icon: '💾' },
    { id: 'editor', label: '编辑器', icon: '📝' },
    { id: 'dock', label: '窗口与吸附', icon: '📌' },
    { id: 'about', label: '关于', icon: 'ℹ️' },
  ];

  let s = $state<AppSettings>(structuredClone(DEFAULT_SETTINGS));
  let tab = $state<Tab>('general');
  let ready = $state(false);
  let saveState = $state<'saved' | 'saving' | 'dirty'>('saved');
  let storage = $state<StorageInfo | null>(null);
  let migratePath = $state('');
  let migrateMsg = $state<{ kind: 'info' | 'error'; text: string } | null>(null);
  let capturing = $state<string | null>(null);
  let shortcutError = $state<string | null>(null);
  let lastEcho = '';

  const effective = $derived(effectiveShortcuts(s.shortcuts));

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleSave() {
    saveState = 'dirty';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = undefined; void saveNow(); }, 300);
  }
  async function saveNow() {
    saveState = 'saving';
    const next = $state.snapshot(s) as AppSettings;
    lastEcho = JSON.stringify(next);
    await saveSettings(next);
    saveState = 'saved';
  }

  function snapshotKey(v: AppSettings): string { return JSON.stringify(v); }

  function setShortcut(id: string, sc: Shortcut | null) {
    shortcutError = null;
    if (sc) {
      if (!isShortcutAllowed(sc)) { shortcutError = '请使用 Ctrl / Alt / Meta 组合键'; return; }
      const conflict = findShortcutConflict(id, sc, s.shortcuts);
      if (conflict) { shortcutError = `与「${conflict}」冲突，请换一组键位`; return; }
    }
    if (sc) s.shortcuts[id] = sc;
    else s.shortcuts[id] = null;
    scheduleSave();
  }
  function resetShortcut(id: string) {
    delete s.shortcuts[id];
    shortcutError = null;
    scheduleSave();
  }
  function resetAllShortcuts() {
    s.shortcuts = {};
    shortcutError = null;
    scheduleSave();
  }

  function onKeyCapture(e: KeyboardEvent) {
    const id = capturing;
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { capturing = null; shortcutError = null; return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { capturing = null; setShortcut(id, null); return; }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return; // 仅修饰键，等待主键
    const sc: Shortcut = { key: e.key };
    if (e.ctrlKey) sc.ctrl = true;
    if (e.altKey) sc.alt = true;
    if (e.shiftKey) sc.shift = true;
    if (e.metaKey) sc.meta = true;
    capturing = null;
    setShortcut(id, sc);
  }

  async function refreshStorage() {
    if (!storageAdminAvailable()) return;
    try { storage = await getStorageInfo(); } catch (err) { migrateMsg = { kind: 'error', text: String(err) }; }
  }
  async function doOpen(path: string) {
    if (!path) { migrateMsg = { kind: 'error', text: '目录路径为空，无法打开（请确认已正确读取存储信息）' }; return; }
    try {
      await openPath(path);
      migrateMsg = { kind: 'info', text: '已在文件管理器中打开：' + path };
    } catch (err) {
      migrateMsg = { kind: 'error', text: '打开目录失败：' + (err instanceof Error ? err.message : String(err)) };
    }
  }
  async function doPickFolder() {
    try {
      const picked = await pickFolder();
      if (picked) { migratePath = picked; migrateMsg = null; }
    } catch (err) {
      migrateMsg = { kind: 'error', text: '选择目录失败：' + (err instanceof Error ? err.message : String(err)) };
    }
  }
  async function doMigrate() {
    migrateMsg = null;
    try {
      storage = await migrateNotes(migratePath.trim());
      migrateMsg = { kind: 'info', text: '迁移完成，笔记已切换到新目录（原目录内容保留）' };
    } catch (err) {
      migrateMsg = { kind: 'error', text: err instanceof Error ? err.message : String(err) };
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKeyCapture, true);
    let unsub: (() => void) | undefined;
    void (async () => {
      s = await loadSettings();
      lastEcho = snapshotKey(s);
      ready = true;
      await refreshStorage();
      unsub = subscribeSettings((next) => {
        if (snapshotKey(next) === lastEcho) return; // 自己保存触发的回声
        s = next;
      });
    })();
    return () => {
      window.removeEventListener('keydown', onKeyCapture, true);
      unsub?.();
      if (saveTimer) clearTimeout(saveTimer);
    };
  });
</script>

{#if !ready}
  <div class="boot">正在读取设置…</div>
{:else}
  <div class="settings-shell">
    <aside class="settings-nav">
      <div class="nav-brand"><span class="logo">N</span><strong>设置</strong></div>
      {#each TABS as t (t.id)}
        <button class="nav-btn" class:active={tab === t.id} onclick={() => (tab = t.id)}>
          <span>{t.icon}</span>{t.label}
        </button>
      {/each}
      <div class="nav-foot">
        <span class="save-ind" class:dirty={saveState !== 'saved'}>
          {saveState === 'saving' ? '保存中…' : saveState === 'dirty' ? '未保存' : '已保存'}
        </span>
      </div>
    </aside>

    <main class="settings-body">
      {#if tab === 'general'}
        <h2>通用</h2>
        <section class="card">
          <div class="row">
            <div class="row-main">
              <label>启动布局</label>
              <p class="hint">打开应用时显示到哪一级（图3 仅侧栏 → 图4 列表 → 图5 完整）</p>
            </div>
            <select value={s.general.startLayout} onchange={(e) => { s.general.startLayout = (e.target as HTMLSelectElement).value as AppSettings['general']['startLayout']; scheduleSave(); }}>
              <option value="fig3">图3 · 仅侧栏</option>
              <option value="fig4">图4 · 侧栏 + 笔记列表</option>
              <option value="fig5">图5 · 完整三栏</option>
            </select>
          </div>
          <div class="row">
            <div class="row-main">
              <label>记住面板开合</label>
              <p class="hint">开启后，重启沿用上次的面板状态与所在文件夹</p>
            </div>
            <input type="checkbox" checked={s.general.rememberPanels} onchange={(e) => { s.general.rememberPanels = (e.target as HTMLInputElement).checked; scheduleSave(); }} />
          </div>
        </section>
      {/if}

      {#if tab === 'shortcuts'}
        <h2>快捷键</h2>
        <p class="hint">点击右侧键位后按下新组合（Esc 取消，Backspace 清除该快捷键）。仅支持带 Ctrl / Alt / Meta 的组合。</p>
        {#if shortcutError}<p class="err">{shortcutError}</p>{/if}
        <section class="card">
          {#each ACTIONS as a (a.id)}
            <div class="row">
              <div class="row-main">
                <label>{a.label}</label>
                {#if a.description}<p class="hint">{a.description}</p>{/if}
              </div>
              <button class="keycap" class:capturing={capturing === a.id} onclick={() => { capturing = a.id; shortcutError = null; }}>
                {capturing === a.id ? '按下组合…' : formatShortcut(effective[a.id])}
              </button>
              <button class="btn-ghost small" onclick={() => resetShortcut(a.id)}>默认</button>
            </div>
          {/each}
        </section>
        <button class="btn-ghost" onclick={resetAllShortcuts}>全部恢复默认</button>
      {/if}

      {#if tab === 'storage'}
        <h2>存储</h2>
        {#if !storageAdminAvailable()}
          <p class="hint">当前为浏览器预览模式，存储位置管理仅在桌面版可用。</p>
        {:else if storage}
          <section class="card">
            <div class="row"><div class="row-main"><label>当前笔记目录</label><p class="hint mono">{storage.notesDir || '（未获取到路径）'}</p></div>
              <button class="btn-ghost small" disabled={!storage.notesDir} onclick={() => void doOpen(storage!.notesDir)}>打开</button></div>
            <div class="row"><div class="row-main"><label>应用数据目录</label><p class="hint mono">{storage.dataDir || '（未获取到路径）'}</p></div>
              <button class="btn-ghost small" disabled={!storage.dataDir} onclick={() => void doOpen(storage!.dataDir)}>打开</button></div>
            <div class="row"><div class="row-main"><label>设置文件</label><p class="hint mono">{storage.settingsFile || '（未获取到路径）'}</p></div></div>
          </section>
          <section class="card">
            <div class="row-main"><label>更改存储位置（迁移）</label>
              <p class="hint">把现有笔记与 meta.json 复制到新目录并切换；建议选择<b>空目录</b>。原目录内容会保留作为备份。</p></div>
            <div class="migrate-row">
              <input type="text" placeholder="点击“浏览…”选择，或直接输入 例如 D:\NoteAppData" value={migratePath} oninput={(e) => (migratePath = (e.target as HTMLInputElement).value)} />
              <button class="btn-ghost" onclick={() => void doPickFolder()}>浏览…</button>
              <button class="btn-primary" disabled={!migratePath.trim()} onclick={doMigrate}>验证并迁移</button>
            </div>
            {#if migrateMsg}<p class:err={migrateMsg.kind === 'error'} class="msg">{migrateMsg.text}</p>{/if}
            {#if storage.isCustom}<p class="hint">当前使用自定义目录；默认目录为 <span class="mono">{storage.defaultNotesDir}</span></p>{/if}
          </section>
        {:else}
          <p class="hint">正在读取存储信息…</p>
          {#if migrateMsg}<p class="err">{migrateMsg.text}</p>{/if}
        {/if}
      {/if}

      {#if tab === 'editor'}
        <h2>编辑器</h2>
        <section class="card">
          <div class="row">
            <div class="row-main"><label>默认视图</label><p class="hint">打开笔记时的默认显示方式</p></div>
            <select value={s.editor.defaultMode} onchange={(e) => { s.editor.defaultMode = (e.target as HTMLSelectElement).value as AppSettings['editor']['defaultMode']; scheduleSave(); }}>
              <option value="edit">编辑</option>
              <option value="split">分屏</option>
              <option value="preview">预览</option>
            </select>
          </div>
          <div class="row">
            <div class="row-main"><label>自动保存去抖</label><p class="hint">{AUTO_SAVE_RANGE.min}–{AUTO_SAVE_RANGE.max} 毫秒；越小越即时，越大越省写入</p></div>
            <input type="number" min={AUTO_SAVE_RANGE.min} max={AUTO_SAVE_RANGE.max} step="50" value={s.editor.autoSaveMs}
              oninput={(e) => { s.editor.autoSaveMs = Number((e.target as HTMLInputElement).value); scheduleSave(); }} />
          </div>
          <div class="row">
            <div class="row-main"><label>拼写检查</label><p class="hint">编辑器内启用系统拼写检查（默认关闭）</p></div>
            <input type="checkbox" checked={s.editor.spellcheck} onchange={(e) => { s.editor.spellcheck = (e.target as HTMLInputElement).checked; scheduleSave(); }} />
          </div>
        </section>
      {/if}

      {#if tab === 'dock'}
        <h2>窗口与吸附</h2>
        <section class="card">
          <div class="row">
            <div class="row-main"><label>侧边吸附</label><p class="hint">拖到屏幕边缘时贴边停靠，鼠标离开后缩进</p></div>
            <input type="checkbox" checked={s.dock.enabled} onchange={(e) => { s.dock.enabled = (e.target as HTMLInputElement).checked; scheduleSave(); }} />
          </div>
          <div class="row">
            <div class="row-main"><label>吸附侧</label></div>
            <select value={s.dock.side} onchange={(e) => { s.dock.side = (e.target as HTMLSelectElement).value as AppSettings['dock']['side']; scheduleSave(); }}>
              <option value="both">左右都支持</option>
              <option value="left">仅左侧</option>
              <option value="right">仅右侧</option>
            </select>
          </div>
          <div class="row">
            <div class="row-main"><label>缩进延迟</label><p class="hint">{HIDE_DELAY_RANGE.min}–{HIDE_DELAY_RANGE.max} 毫秒（鼠标离开窗口后）</p></div>
            <input type="number" min={HIDE_DELAY_RANGE.min} max={HIDE_DELAY_RANGE.max} step="500" value={s.dock.hideDelayMs}
              oninput={(e) => { s.dock.hideDelayMs = Number((e.target as HTMLInputElement).value); scheduleSave(); }} />
          </div>
          <div class="row">
            <div class="row-main"><label>缩进后置顶</label></div>
            <input type="checkbox" checked={s.dock.topmost} onchange={(e) => { s.dock.topmost = (e.target as HTMLInputElement).checked; scheduleSave(); }} />
          </div>
          <div class="row">
            <div class="row-main"><label>唤出热区宽度</label><p class="hint">{HOT_ZONE_RANGE.min}–{HOT_ZONE_RANGE.max} 像素（屏幕边缘）</p></div>
            <input type="number" min={HOT_ZONE_RANGE.min} max={HOT_ZONE_RANGE.max} value={s.dock.hotZonePx}
              oninput={(e) => { s.dock.hotZonePx = Number((e.target as HTMLInputElement).value); scheduleSave(); }} />
          </div>
          <div class="row">
            <div class="row-main"><label>仅侧栏态生效</label><p class="hint">只在图3（仅侧栏）时吸附，展开后自动取消停靠</p></div>
            <input type="checkbox" checked={s.dock.onlySidebar} onchange={(e) => { s.dock.onlySidebar = (e.target as HTMLInputElement).checked; scheduleSave(); }} />
          </div>
        </section>
      {/if}

      {#if tab === 'about'}
        <h2>关于</h2>
        <section class="card">
          <div class="row"><div class="row-main"><label>NoteApp</label><p class="hint">本地 Markdown 笔记 · 版本 {storage?.appVersion ?? '0.1.0'}</p></div></div>
          <div class="row"><div class="row-main"><label>数据位置</label><p class="hint mono">{storage?.notesDir ?? '（浏览器预览模式）'}</p></div>
            {#if storage}<button class="btn-ghost small" onclick={() => void doOpen(storage!.dataDir)}>打开数据目录</button>{/if}
          </div>
          <div class="row"><div class="row-main"><label>快捷键入口</label><p class="hint">⌘/Ctrl + , 可随时打开本设置窗口</p></div></div>
        </section>
      {/if}
    </main>
  </div>
{/if}

<style>
  .settings-shell { display: grid; grid-template-columns: 176px minmax(0, 1fr); height: 100vh; background: var(--bg); }
  .settings-nav { display: flex; flex-direction: column; gap: 2px; padding: 12px 10px; background: #fafbfc; border-right: 1px solid var(--border); }
  .nav-brand { display: flex; align-items: center; gap: 8px; padding: 4px 6px 12px; font-size: 15px; }
  .nav-brand .logo { width: 26px; height: 26px; border-radius: 7px; display: grid; place-content: center; background: linear-gradient(135deg, #2f6feb, #6f42c1); color: #fff; font-weight: 700; font-size: 14px; }
  .nav-btn { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 9px; border-radius: 8px; text-align: left; color: var(--text); font-size: 13px; }
  .nav-btn:hover { background: #eef1f5; }
  .nav-btn.active { background: var(--accent-weak); color: var(--accent); font-weight: 600; }
  .nav-foot { margin-top: auto; padding: 8px 6px; }
  .save-ind { font-size: 12px; color: var(--ok); }
  .save-ind.dirty { color: #b08800; }
  .settings-body { padding: 20px 24px 40px; overflow-y: auto; }
  .settings-body h2 { margin: 0 0 12px; font-size: 18px; }
  .card { background: #fff; border: 1px solid var(--border); border-radius: 10px; padding: 6px 14px; margin-bottom: 14px; }
  .row { display: flex; align-items: center; gap: 14px; padding: 10px 0; border-bottom: 1px solid #f0f2f5; }
  .row:last-child { border-bottom: none; }
  .row-main { flex: 1; min-width: 0; }
  .row-main label { font-size: 13.5px; }
  .hint { margin: 2px 0 0; font-size: 12px; color: var(--text-2); }
  .mono { font-family: var(--mono); font-size: 12px; word-break: break-all; }
  .err { color: var(--danger); font-size: 12.5px; margin: 6px 0; }
  .msg { font-size: 12.5px; color: var(--ok); margin: 8px 0 2px; }
  .msg.err { color: var(--danger); }
  .row select, .row input[type='number'] { min-width: 140px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 7px; }
  .keycap {
    min-width: 132px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 7px;
    background: #fff; font-family: var(--mono); font-size: 12px; color: var(--text);
  }
  .keycap:hover { border-color: var(--accent); color: var(--accent); }
  .keycap.capturing { border-color: var(--accent); color: var(--accent); background: var(--accent-weak); }
  .migrate-row { display: flex; gap: 8px; margin-top: 8px; }
  .migrate-row input { flex: 1; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; }
  .btn-ghost.small, .btn-primary.small { padding: 4px 10px; font-size: 12px; }
  .boot { height: 100vh; display: grid; place-content: center; color: var(--text-2); }
</style>
