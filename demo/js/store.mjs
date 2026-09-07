// store.mjs —— 演示用“模拟数据层”
// 说明：本模块只有内存数据与纯函数，不含真实后端。
// 浏览器端会额外把数据持久化到 localStorage，仅为演示体验更真实。

export const FOLDERS = ['收件箱', '工作', '学习', '待办'];

export function uid() {
  return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const iso = (ts) => new Date(ts).toISOString();

// ---- 模拟种子数据：8 条风格各异的示例笔记 ----
export function defaultSeed(now = Date.now()) {
  const min = 60 * 1000;
  const hr = 60 * min;
  const day = 24 * hr;
  const ago = (ms) => iso(now - ms);

  const notes = [
    {
      id: 'n-welcome',
      folder: '收件箱',
      title: '欢迎使用 NoteApp 👋',
      body: [
        '# 欢迎使用 NoteApp 👋',
        '',
        '这是一个 **MVP 界面演示**，没有真实后端，所有数据都是本地模拟的，存在你的浏览器里。',
        '',
        '## 你可以试试',
        '',
        '- 点击左上角「＋ 新建笔记」随手记一条',
        '- 在中部列表顶部的搜索框输入 `Rust`、`周报` 或 `鉴权`',
        '- 在右侧预览里**勾选待办**，源文会自动同步',
        '- 切换「编辑 / 分屏 / 预览」三种视图',
        '',
        '> 提示：按 `Ctrl+S` 立即保存，按 `?` 查看全部快捷键。',
      ].join('\n'),
      createdAt: ago(4 * day),
      updatedAt: ago(2 * min),
    },
    {
      id: 'n-inspire',
      folder: '收件箱',
      title: '灵感：给产品加一个“周回顾”视图',
      body: [
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
      ].join('\n'),
      createdAt: ago(3 * day),
      updatedAt: ago(23 * min),
    },
    {
      id: 'n-standup',
      folder: '工作',
      title: '2025-06-09 站会记录',
      body: [
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
      ].join('\n'),
      createdAt: ago(6 * day),
      updatedAt: ago(3 * hr),
    },
    {
      id: 'n-auth',
      folder: '工作',
      title: '接口鉴权重构方案（草稿）',
      body: [
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
      ].join('\n'),
      createdAt: ago(8 * day),
      updatedAt: ago(26 * hr),
    },
    {
      id: 'n-rust',
      folder: '学习',
      title: 'Rust 所有权速查',
      body: [
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
      ].join('\n'),
      createdAt: ago(9 * day),
      updatedAt: ago(2 * day),
    },
    {
      id: 'n-vim',
      folder: '学习',
      title: 'Vim 高频命令备忘',
      body: [
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
      ].join('\n'),
      createdAt: ago(5 * day),
      updatedAt: ago(5 * hr),
    },
    {
      id: 'n-todo',
      folder: '待办',
      title: '本周待办清单',
      body: [
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
      ].join('\n'),
      createdAt: ago(2 * day),
      updatedAt: ago(1 * hr),
    },
    {
      id: 'n-weekly',
      folder: '学习',
      title: '好文收藏：如何写出清晰的周报',
      body: [
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
      ].join('\n'),
      createdAt: ago(3 * day),
      updatedAt: ago(30 * hr),
    },
  ];
  return notes;
}

// ---- 基础 CRUD（纯函数，输入 notes 数组，输出新数组/对象）----

export function createNote(notes, opts = {}) {
  const now = opts.now || Date.now();
  const note = {
    id: opts.id || uid(),
    folder: opts.folder || '收件箱',
    title: opts.title ?? '无标题笔记',
    body: opts.body ?? '',
    createdAt: iso(now),
    updatedAt: iso(now),
  };
  return { notes: [note, ...notes], note };
}

export function updateNote(notes, id, patch, now = Date.now()) {
  return notes.map((n) =>
    n.id === id ? { ...n, ...patch, updatedAt: iso(now) } : n
  );
}

export function deleteNote(notes, id) {
  return notes.filter((n) => n.id !== id);
}

// 勾选/取消勾选任务：offset 指向任务行开头 '-' 的位置（由渲染器记录）。
// 带保护：如果该位置已不是任务行则原样返回。
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

// ---- 查询与统计 ----

export function sortByUpdated(notes) {
  return [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function folderCounts(notes, folders = FOLDERS) {
  const map = Object.fromEntries(folders.map((f) => [f, 0]));
  for (const n of notes) {
    if (!(n.folder in map)) map[n.folder] = 0;
    map[n.folder] += 1;
  }
  return map;
}

function makeSnippet(text, idx, len) {
  const start = Math.max(0, idx - 16);
  const end = Math.min(text.length, idx + len + 48);
  const head = start > 0 ? '…' + text.slice(start, idx) : text.slice(start, idx);
  const hit = text.slice(idx, idx + len);
  const tail = text.slice(idx + len, end) + (end < text.length ? '…' : '');
  return head + '<mark>' + hit + '</mark>' + tail;
}

// 返回 null 表示无查询；否则返回按相关度排序的结果：
// [{ note, snippet, where: 'title' | 'body' }]
export function searchNotes(notes, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return null;
  const out = [];
  for (const note of notes) {
    const title = note.title.toLowerCase();
    const body = (note.body || '').toLowerCase();
    const ti = title.indexOf(q);
    if (ti >= 0) {
      out.push({ note, where: 'title', snippet: makeSnippet(note.title, ti, q.length) });
      continue;
    }
    const bi = body.indexOf(q);
    if (bi >= 0) {
      out.push({ note, where: 'body', snippet: makeSnippet(note.body, bi, q.length) });
    }
  }
  const rank = { title: 0, body: 1 };
  return out.sort((a, b) => rank[a.where] - rank[b.where]);
}

// 取正文首段纯文本（列表项摘要用）
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

// ---- localStorage 持久化（演示用，浏览器环境才生效）----
const STORAGE_KEY = 'noteapp.mvp.demo.v1';

export function loadSaved(seedFn) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.notes) && data.notes.length > 0) return data.notes;
    }
  } catch (e) {
    /* 数据损坏则回退种子 */
  }
  const notes = seedFn();
  saveState(notes);
  return notes;
}

export function saveState(notes) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ notes, savedAt: new Date().toISOString() }));
  } catch (e) {
    /* 忽略配额等错误 */
  }
}

export function clearSaved() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    /* ignore */
  }
}
