// store.mjs —— 演示用“模拟数据层”（纯函数，无真实后端）
//
// 数据模型（配合需求重构）：
//   folders: [{ id, name, order, trashed, trashedAt }]
//   notes:   [{ id, folderId, title, body, order, createdAt, updatedAt, trashed, trashedAt }]
// 说明：
//   - 文件夹删除 = 文件夹与其中笔记一并标记 trashed（保留原始结构，可整组还原）
//   - 笔记删除   = 仅标记 trashed（可还原 / 可彻底删除）
//   - order 用于文件夹排序与文件夹内笔记排序
// 浏览器端由 db.mjs(IndexedDB) / localStorage 持久化，此处只做内存纯函数。

export const DEFAULT_FOLDER_IDS = { inbox: 'f-inbox', work: 'f-work', study: 'f-study', todo: 'f-todo' };

export function uid(prefix = 'x') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const iso = (ts) => new Date(ts).toISOString();

export function defaultSeed(now = Date.now()) {
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  const ago = (ms) => iso(now - ms);
  const F = DEFAULT_FOLDER_IDS;

  const folders = [
    { id: F.inbox, name: '收件箱', order: 0 },
    { id: F.work, name: '工作', order: 1 },
    { id: F.study, name: '学习', order: 2 },
    { id: F.todo, name: '待办', order: 3 },
  ];

  let n = 0;
  const N = (folderId, title, body, createdAgo, updatedAgo) => ({
    id: 'n-seed' + (n++),
    folderId,
    title,
    body,
    order: 0,
    createdAt: ago(createdAgo),
    updatedAt: ago(updatedAgo),
  });
  const raw = [
    N(F.inbox, '欢迎使用 NoteApp 👋', [
      '# 欢迎使用 NoteApp 👋',
      '',
      '这是一个 **MVP 界面演示**，没有真实后端，所有数据都存在浏览器本地（IndexedDB）。',
      '',
      '## 你可以试试',
      '',
      '- **点击文件夹**展开/收起其下的笔记（▶/▼ 箭头）',
      '- **双击文件夹名**重命名；**悬停文件夹**右侧出现 ✕ 可删除',
      '- **右键**文件夹 / 笔记 / 空白处，查看上下文菜单',
      '- 把笔记**拖到**另一个文件夹上完成移动；**拖文件夹**调整顺序',
      '- 删除的笔记与文件夹会进入左下角 **🗑️ 回收站**，可还原',
      '- 顶部搜索框或 `Ctrl+K`：搜索全部笔记（**含回收站**）',
      '',
      '> 提示：`Ctrl+S` 立即保存，`?` 查看快捷键；右上角 ⤢ 可模拟“靠边隐藏”。',
    ].join('\n'), 4 * day, 2 * min),
    N(F.inbox, '灵感：给产品加一个“周回顾”视图', [
      '# 灵感：给产品加一个“周回顾”视图',
      '',
      '周末花 10 分钟回看这周的笔记，自动生成回顾：',
      '',
      '- 本周**新增**了多少条笔记、主题分布',
      '- 还有哪些 *未完成* 的待办',
      '- 引用上周立下的 Flag 做对比',
      '',
      '> 好想法应该像 **种子**，先记下来，再慢慢长大。',
      '',
      '相关标签：`weekly-review`，可放入 P2 再讨论。',
    ].join('\n'), 3 * day, 23 * min),
    N(F.work, '2025-06-09 站会记录', [
      '# 2025-06-09 站会记录',
      '',
      '- [x] 报告鉴权模块联调进度',
      '- [ ] 和前端确认错误码文档格式',
      '- [ ] 预定周四评审会议室',
      '',
      '## 要点',
      '',
      '1. 联调环境已就绪，今天可以开始',
      '2. 错误码需要补充 401 场景的说明',
      '3. 竞品调研见「接口鉴权重构方案」',
    ].join('\n'), 6 * day, 3 * hr),
    N(F.work, '接口鉴权重构方案（草稿）', [
      '# 接口鉴权重构方案（草稿）',
      '',
      '现状：各服务自己校验，规则不统一。目标：统一走网关签发与校验，并支持多租户隔离。',
      '',
      '## 主要改动',
      '',
      '- 网关统一签发 / 校验 Token',
      '- 服务侧只信任网关透传的用户上下文',
      '',
      '```js',
      'async function auth(req, res, next) {',
      '  const token = req.headers["authorization"];',
      '  const payload = await verifyJwt(token); // 校验签名与过期',
      '  if (!payload) return res.status(401).json({ error: "unauthorized" });',
      '  req.user = payload;',
      '  next();',
      '}',
      '```',
      '',
      '> 待讨论：刷新令牌是否改用 Cookie 下发？',
    ].join('\n'), 8 * day, 26 * hr),
    N(F.study, 'Rust 所有权速查', [
      '# Rust 所有权速查',
      '',
      '- `String` 与 `&str`：前者拥有数据，后者只是借用',
      '- 借用规则：同一时刻要么多个不可变借用，要么一个可变借用',
      '- 生命周期标注只影响借用检查，不改变运行时行为',
      '',
      '```rust',
      'fn main() {',
      '    let s = String::from("hello"); // s 拥有这段堆内存',
      '    let len = calc_len(&s);        // 只借用，不移交所有权',
      '    println!("{} 的长度是 {}", s, len);',
      '}',
      '',
      'fn calc_len(text: &str) -> usize {',
      '    text.len()',
      '}',
      '```',
    ].join('\n'), 9 * day, 2 * day),
    N(F.study, 'Vim 高频命令备忘', [
      '# Vim 高频命令备忘',
      '',
      '- `gg` 到文首，`G` 到文末',
      '- `dd` 删除整行，`yy` 复制整行，`p` 粘贴',
      '- `:wq` 保存退出，`:q!` 不保存退出',
      '- `/keyword` 向下搜索',
      '',
      '```bash',
      '# 一键格式化并保存',
      'gg=G',
      ':wq',
      '```',
    ].join('\n'), 5 * day, 5 * hr),
    N(F.todo, '本周待办清单', [
      '# 本周待办清单',
      '',
      '## 工作',
      '',
      '- [x] 完成鉴权重构的技术方案',
      '- [ ] 输出联调排期表',
      '- [ ] 周五前合入演示分支',
      '',
      '## 生活',
      '',
      '- [x] 续健身卡',
      '- [ ] 预约体检',
      '- [ ] 给绿萝换水',
    ].join('\n'), 2 * day, 1 * hr),
    N(F.study, '好文收藏：如何写出清晰的周报', [
      '# 好文收藏：如何写出清晰的周报',
      '',
      '本周读到一篇不错的文章，核心观点：',
      '',
      '> 周报不是流水账，而是给未来自己的一份地图。',
      '',
      '结构建议：**结论先行** → 关键进展（尽量给数据）→ 风险与求助 → 下周计划。',
      '',
      '原文：https://example.com/weekly-report-guide',
      '',
      '- [ ] 按这个结构重写本周周报',
    ].join('\n'), 3 * day, 30 * hr),
  ];

  // 给每个文件夹内的笔记按出现顺序分配 order
  const counter = {};
  for (const note of raw) {
    note.order = counter[note.folderId] || 0;
    counter[note.folderId] = (counter[note.folderId] || 0) + 1;
  }
  return { folders, notes: raw };
}

// ================= 基础查询 =================

export const isTrashedNote = (n) => !!n.trashed;
export const isTrashedFolder = (f) => !!f.trashed;

export function getFolder(folders, id) {
  return folders.find((f) => f.id === id) || null;
}

export function folderNameOf(folders, id) {
  const f = getFolder(folders, id);
  return f ? f.name : '（已删除的文件夹）';
}

export function activeFolders(folders) {
  return folders.filter((f) => !f.trashed).sort((a, b) => a.order - b.order);
}

export function trashedFolders(folders) {
  return folders.filter(isTrashedFolder).sort((a, b) => (a.trashedAt || '').localeCompare(b.trashedAt || ''));
}

export function trashedNotes(notes) {
  return notes.filter(isTrashedNote).sort((a, b) => (a.trashedAt || '').localeCompare(b.trashedAt || ''));
}

// 文件夹内 未删除 笔记，按 order 升序
export function notesOfFolder(notes, folderId) {
  return notes
    .filter((n) => n.folderId === folderId && !n.trashed)
    .sort((a, b) => a.order - b.order || b.updatedAt.localeCompare(a.updatedAt));
}

// “全部笔记”视图顺序：按文件夹顺序 → 文件夹内 order
export function allActiveNotes(notes, folders) {
  const byF = new Map();
  for (const f of activeFolders(folders)) byF.set(f.id, notesOfFolder(notes, f.id));
  const out = [];
  for (const f of activeFolders(folders)) out.push(...byF.get(f.id));
  return out;
}

export function countActiveByFolder(notes) {
  const map = {};
  for (const n of notes) {
    if (!n.trashed) map[n.folderId] = (map[n.folderId] || 0) + 1;
  }
  return map;
}

export function binCount(notes, folders) {
  return trashedFolders(folders).length + trashedNotes(notes).length;
}

// ================= 文件夹操作 =================

export function createFolder(folders, name = '新建文件夹') {
  const order = folders.length ? Math.max(...folders.map((f) => f.order)) + 1 : 0;
  const folder = { id: uid('f'), name, order };
  return { folders: [...folders, folder], folder };
}

export function renameFolder(folders, id, name) {
  const next = (name || '').trim();
  if (!next) return folders;
  return folders.map((f) => (f.id === id ? { ...f, name: next } : f));
}

export function applyFolderOrder(folders, orderedFolderIds) {
  const index = new Map(orderedFolderIds.map((id, i) => [id, i]));
  return folders.map((f) => ({ ...f, order: index.has(f.id) ? index.get(f.id) : f.order }));
}

// 删除文件夹：文件夹与其下未删除的笔记都进入回收站（保留结构）
export function deleteFolder(folders, notes, folderId, now = Date.now()) {
  const at = iso(now);
  const folders2 = folders.map((f) => (f.id === folderId && !f.trashed ? { ...f, trashed: true, trashedAt: at } : f));
  const notes2 = notes.map((n) => (n.folderId === folderId && !n.trashed ? { ...n, trashed: true, trashedAt: at } : n));
  return { folders: folders2, notes: notes2 };
}

// 还原文件夹：文件夹与其下全部笔记（无论怎么被删）一并还原
export function restoreFolder(folders, notes, folderId) {
  const folders2 = folders.map((f) => (f.id === folderId ? { ...f, trashed: false, trashedAt: undefined } : f));
  const notes2 = notes.map((n) => (n.folderId === folderId && n.trashed ? { ...n, trashed: false, trashedAt: undefined } : n));
  return { folders: folders2, notes: notes2 };
}

// 彻底删除文件夹：连同其下所有笔记（含已删）一并移除
export function purgeFolder(folders, notes, folderId) {
  return {
    folders: folders.filter((f) => f.id !== folderId),
    notes: notes.filter((n) => n.folderId !== folderId),
  };
}

// ================= 笔记操作 =================

function nextOrder(notes, folderId) {
  const max = notes
    .filter((n) => n.folderId === folderId && !n.trashed)
    .reduce((m, n) => Math.max(m, n.order), -1);
  return max + 1;
}

export function createNote(notes, opts = {}) {
  const now = opts.now || Date.now();
  const folderId = opts.folderId || DEFAULT_FOLDER_IDS.inbox;
  const note = {
    id: opts.id || uid('n'),
    folderId,
    title: opts.title ?? '无标题笔记',
    body: opts.body ?? '',
    order: opts.order ?? nextOrder(notes, folderId),
    createdAt: iso(now),
    updatedAt: iso(now),
  };
  return { notes: [...notes, note], note };
}

export function updateNote(notes, id, patch, now = Date.now()) {
  return notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: iso(now) } : n));
}

// 单条删除 → 移入回收站（可还原）
export function deleteNote(notes, id, now = Date.now()) {
  const at = iso(now);
  return notes.map((n) => (n.id === id && !n.trashed ? { ...n, trashed: true, trashedAt: at } : n));
}

// 批量删除 → 移入回收站
export function deleteNotes(notes, ids, now = Date.now()) {
  const set = new Set(ids);
  const at = iso(now);
  return notes.map((n) => (set.has(n.id) && !n.trashed ? { ...n, trashed: true, trashedAt: at } : n));
}

export function restoreNote(notes, id) {
  return notes.map((n) => (n.id === id ? { ...n, trashed: false, trashedAt: undefined } : n));
}

export function purgeNote(notes, id) {
  return notes.filter((n) => n.id !== id);
}

export function purgeNotes(notes, ids) {
  const set = new Set(ids);
  return notes.filter((n) => !set.has(n.id));
}

// 移动 / 还原到指定文件夹（若笔记在回收站则一并还原）
export function moveNoteToFolder(notes, noteId, folderId, now = Date.now()) {
  return notes.map((n) => {
    if (n.id !== noteId) return n;
    return {
      ...n,
      folderId,
      trashed: false,
      trashedAt: undefined,
      order: nextOrder(notes, folderId),
      updatedAt: iso(now),
    };
  });
}

// 设置某文件夹内笔记排序（按 orderedIds 出现顺序，仅作用于该文件夹）
export function applyNoteOrder(notes, folderId, orderedIds) {
  const set = new Set(orderedIds);
  const index = new Map(orderedIds.map((id, i) => [id, i]));
  return notes.map((n) => {
    if (n.folderId !== folderId || !set.has(n.id)) return n;
    return { ...n, order: index.get(n.id) };
  });
}

// ================= 搜索 =================

function makeSnippet(text, idx, len) {
  const start = Math.max(0, idx - 16);
  const end = Math.min(text.length, idx + len + 48);
  const head = start > 0 ? '…' + text.slice(start, idx) : text.slice(start, idx);
  const hit = text.slice(idx, idx + len);
  const tail = text.slice(idx + len, end) + (end < text.length ? '…' : '');
  return head + '<mark>' + hit + '</mark>' + tail;
}

// 搜索全部笔记（含回收站），返回 [{ note, where, snippet, folderName }]
export function searchNotes(notes, folders, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const note of notes) {
    const title = (note.title || '').toLowerCase();
    const body = (note.body || '').toLowerCase();
    let where = null;
    let snippet = '';
    const ti = title.indexOf(q);
    if (ti >= 0) {
      where = 'title';
      snippet = makeSnippet(note.title || '', ti, q.length);
    } else {
      const bi = body.indexOf(q);
      if (bi >= 0) {
        where = 'body';
        snippet = makeSnippet(note.body || '', bi, q.length);
      }
    }
    if (where) {
      out.push({ note, where, snippet, folderName: folderNameOf(folders, note.folderId) });
    }
  }
  // 标题命中优先；同类按更新时间倒序
  out.sort((a, b) =>
    a.where === b.where ? b.note.updatedAt.localeCompare(a.note.updatedAt) : a.where === 'title' ? -1 : 1
  );
  return out;
}

// ================= 展示辅助 =================

export function plainTextOf(md) {
  return (md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+\[[ xX]\]\s*/gm, '')
    .replace(/^[-*+]\s*/gm, '')
    .replace(/^\d+\.\s*/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function relativeTime(isoStr, now = Date.now()) {
  const diff = Math.max(0, now - new Date(isoStr).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return '刚刚';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d === 1) return '昨天';
  if (d < 7) return `${d} 天前`;
  return new Date(isoStr).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

// 勾选/取消勾选任务（渲染器记录任务行起始偏移）
export function toggleTask(body, offset) {
  if (typeof body !== 'string' || !Number.isInteger(offset)) return body;
  const head = body.slice(offset, offset + 6);
  if (!/^[-*] \[[ xX]\]/.test(head)) return body;
  const ch = offset + 3;
  const cur = body[ch];
  if (cur !== ' ' && cur !== 'x' && cur !== 'X') return body;
  const next = cur === ' ' ? 'x' : ' ';
  return body.slice(0, ch) + next + body.slice(ch + 1);
}

// ================= 持久化（localStorage 降级；主通道为 db.mjs 的 IndexedDB） =================
const LOCAL_KEY = 'noteapp.mvp.demo.v1';

function shapeOk(data) {
  return data && Array.isArray(data.folders) && Array.isArray(data.notes) && data.folders.length > 0;
}

export function loadSavedLocal(seedFn) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (shapeOk(data)) return data;
    }
  } catch (e) {
    /* ignore */
  }
  const seed = seedFn();
  saveStateLocal(seed);
  return seed;
}

export function saveStateLocal(state) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ folders: state.folders, notes: state.notes, savedAt: new Date().toISOString() }));
  } catch (e) {
    /* ignore */
  }
}

export function clearSavedLocal() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch (e) {
    /* ignore */
  }
}
