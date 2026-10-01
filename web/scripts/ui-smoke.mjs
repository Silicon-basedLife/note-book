// scripts/ui-smoke.mjs —— 真实 Chrome（CDP）端到端冒烟（增强版 UI）
// 前置：带 --remote-debugging-port=9222 的 headless Chrome（独立 user-data-dir）＋静态托管 web/dist。
// 运行：SMOKE_URL=... CDP_PORT=... node scripts/ui-smoke.mjs
import WebSocket from 'ws';

const DEBUG = process.env.CDP_PORT || '9222';
const APP_URL = process.env.SMOKE_URL || 'http://localhost:5174/';
const BASE = `http://127.0.0.1:${DEBUG}`;

const target = await (async () => {
  const resp = await fetch(`${BASE}/json/new?about:blank`, { method: 'PUT' });
  if (!resp.ok)
    throw new Error(
      `CDP 不可用 (${resp.status})：请先启动 --remote-debugging-port=${DEBUG} 的 Chrome`,
    );
  return resp.json();
})();

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.on('open', res);
  ws.on('error', rej);
});
let seq = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (!msg.id || !pending.has(msg.id)) return;
  const p = pending.get(msg.id);
  pending.delete(msg.id);
  msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    const msg = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'unknown';
    console.log('      [eval-warn] ' + msg.split('\n')[0]);
    return undefined;
  }
  return r.result.value;
}
async function waitEval(expression, timeoutMs = 15000, step = 220) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await evaluate(expression)) return true;
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__errs = [];
    window.addEventListener('error', (e) => window.__errs.push('err: ' + (e.message || String(e))));
    window.addEventListener('unhandledrejection', (e) => window.__errs.push('rej: ' + String(e.reason)));
    window.__setValue = (el, v) => { if (!el) return false; el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; };
    window.__ctxAt = (el) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    };
    window.__ready = () => !!document.querySelector('.app-shell');
  `,
});

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function pickCtxItem(exprText, itemText) {
  const elExpr = `(() => { const el = ${exprText}; if (!el) return null; window.__ctxAt(el); return true; })()`;
  const fired = await evaluate(elExpr);
  if (!fired) return false;
  const shown = await waitEval(`document.querySelectorAll('.ctx-item').length > 0`, 3000);
  if (!shown) return false;
  const okItem = await waitEval(
    `[...document.querySelectorAll('.ctx-item')].some((b) => b.textContent.includes(${JSON.stringify(itemText)}))`,
    3000,
  );
  if (!okItem) {
    console.log(
      '      [ctx items]',
      await evaluate(
        `JSON.stringify([...document.querySelectorAll('.ctx-item')].map((b) => b.textContent))`,
      ),
    );
    return false;
  }
  await evaluate(
    `[...document.querySelectorAll('.ctx-item')].find((b) => b.textContent.includes(${JSON.stringify(itemText)})).click()`,
  );
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.navigate', { url: APP_URL });
// 确定性前置：清空设置与本地数据库，避免上一次运行残留影响默认态断言
await waitEval(`!!document.body`, 8000);
await evaluate(`(async () => {
  try { localStorage.clear(); } catch {}
  await new Promise((res) => { const r = indexedDB.deleteDatabase('noteapp'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  return true;
})()`);
await send('Page.reload', { ignoreCache: true });
check('启动并渲染主界面', await waitEval('window.__ready()', 25000));
check(
  '默认仅侧栏（图3：笔记列/编辑区收起）',
  await waitEval(
    `!document.querySelector('.list-pane.open') && !document.querySelector('.editor-pane.open') && !!document.querySelector('.seam-a')`,
  ),
);

// 0) 主题：默认浅色 → 深色持久化并可渲染
const BG = `getComputedStyle(document.body).backgroundColor`;
check(
  '默认主题为浅色（data-theme=light）',
  await waitEval(`document.documentElement.dataset.theme === 'light'`),
);
check(
  '浅色下页面底色为亮色',
  await evaluate(
    `(() => { const m = (${BG}).match(/\\d+/g); return !!m && Number(m[0]) > 200; })()`,
  ),
);
await evaluate(
  `(() => { localStorage.setItem('noteapp.settings.v1', JSON.stringify({ version: 1, general: { theme: 'dark' } })); return true; })()`,
);
await send('Page.reload', { ignoreCache: true });
check(
  '深色主题重载后仍生效',
  await waitEval(`window.__ready() && document.documentElement.dataset.theme === 'dark'`, 25000),
);
check(
  '深色下页面底色变暗',
  await evaluate(
    `(() => { const m = (${BG}).match(/\\d+/g); return !!m && Number(m[0]) < 120; })()`,
  ),
);
await evaluate(`(() => { localStorage.removeItem('noteapp.settings.v1'); return true; })()`);
await send('Page.reload', { ignoreCache: true });
check(
  '清除设置后回到浅色默认',
  await waitEval(`window.__ready() && document.documentElement.dataset.theme === 'light'`, 25000),
);

if (await evaluate('window.__ready()')) {
  // 1) 空白右键 → 新建文件夹「工作」
  await evaluate(
    `(() => { const el = document.querySelector('.nav-scroll'); if (!el) return false; window.__ctxAt(el); return true; })()`,
  );
  check('空白处右键出菜单', await waitEval(`!!document.querySelector('.ctx-menu')`));
  await sleep(120);
  check(
    '菜单项“新建文件夹”可点',
    (await pickCtxItem(`document.querySelector('.nav-scroll')`, '新建文件夹')) === true,
  );
  check('出现命名输入框', await waitEval(`!!document.querySelector('.prompt-input')`));
  await evaluate(`window.__setValue(document.querySelector('.prompt-input'), '工作')`);
  await evaluate(`[...document.querySelectorAll('.modal-actions button')].at(-1).click()`);
  check(
    '文件夹「工作」已创建',
    await waitEval(
      `[...document.querySelectorAll('.folder-name')].some((n) => n.textContent === '工作')`,
    ),
  );

  // 2) 文件夹右键 → 在其中新建笔记
  check(
    '文件夹右键“在其中新建笔记”',
    await pickCtxItem(
      `[...document.querySelectorAll('.folder-item')].find((f) => f.textContent.includes('工作'))`,
      '中新建笔记',
    ),
  );
  check(
    '进入编辑态',
    await waitEval(
      `!!document.querySelector('.title-input') && !!document.querySelector('#editor')`,
    ),
  );

  // 3) 书写 → 自动保存
  await evaluate(`window.__setValue(document.querySelector('.title-input'), '独门笔记')`);
  await evaluate(`window.__setValue(document.querySelector('#editor'), '内容包含暗号KDX2026')`);
  // 触发真实保存（Ctrl+S），再校验“已保存”与列表标题
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))`,
  );
  check(
    '自动保存“已保存”',
    await waitEval(
      `document.querySelector('.save-status') && document.querySelector('.save-status').textContent.includes('已保存')`,
      9000,
    ),
  );
  check(
    '标题同步列表',
    await waitEval(
      `[...document.querySelectorAll('.note-title')].some((n) => n.textContent === '独门笔记')`,
      9000,
    ),
  );
  // 同一笔记点击循环：开 → 收 → 再开
  await evaluate(
    `[...document.querySelectorAll('.note-title')].find((n) => n.textContent === '独门笔记').closest('.note-row').click()`,
  );
  check('再点当前笔记收回编辑区', await waitEval(`!document.querySelector('.editor-pane.open')`));
  await evaluate(
    `[...document.querySelectorAll('.note-title')].find((n) => n.textContent === '独门笔记').closest('.note-row').click()`,
  );
  check(
    '第三次点击重新展开编辑区',
    await waitEval(
      `document.querySelector('.editor-pane.open') && document.querySelector('.title-input').value === '独门笔记'`,
    ),
  );

  // 4) 双击文件夹重命名 工作 → 工作甲
  await evaluate(
    `(() => { const n = [...document.querySelectorAll('.folder-name')].find((x) => x.textContent === '工作'); if (!n) return false; n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true; })()`,
  );
  check('双击进入重命名', await waitEval(`!!document.querySelector('.folder-rename input')`));
  await evaluate(`window.__setValue(document.querySelector('.folder-rename input'), '工作甲')`);
  await evaluate(
    `document.querySelector('.folder-rename input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`,
  );
  check(
    '重命名为「工作甲」',
    await waitEval(
      `[...document.querySelectorAll('.folder-name')].some((n) => n.textContent === '工作甲')`,
    ),
  );

  // 5) 回收站：删除 → 只读视图 → 还原
  check(
    '编辑区已展开（图5）',
    await waitEval(
      `!!document.querySelector('.editor-pane.open') && document.querySelector('.title-input').value === '独门笔记'`,
    ),
  );
  // 重命名后重新点进该文件夹（改名后侧栏顺序可能变化，显式点一下保证 activeFolder 是当前文件夹）
  await evaluate(
    `(() => { const b = [...document.querySelectorAll('.folder-item .folder-main')].find((x) => x.textContent.includes('工作甲')); if (b) b.click(); return true; })()`,
  );
  await waitEval(
    `[...document.querySelectorAll('.note-title')].some((n) => n.textContent === '独门笔记')`,
    8000,
  );

  // 5.5) 标签：添加 → 筛选 → 取消筛选 → 移除（写在 frontmatter 的 tags 里）
  check(
    '编辑区出现标签编辑行',
    await waitEval(`!!document.querySelector('#tag-editor #tag-input')`),
  );
  await evaluate(`window.__setValue(document.querySelector('#tag-input'), '工作 重要')`);
  await evaluate(
    `document.querySelector('#tag-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`,
  );
  check(
    '标签写入编辑区（工作 / 重要）',
    await waitEval(
      `(() => { const t = [...document.querySelectorAll('#tag-editor .tag-chip[data-tag]')].map((c) => c.dataset.tag); return t.includes('工作') && t.includes('重要'); })()`,
      8000,
    ),
  );
  check(
    '列表出现标签筛选条',
    await waitEval(
      `[...document.querySelectorAll('#tagbar .tag-chip')].some((c) => c.dataset.tag === '工作')`,
      8000,
    ),
  );
  await evaluate(
    `[...document.querySelectorAll('#tagbar .tag-chip')].find((c) => c.dataset.tag === '工作').click()`,
  );
  check(
    '按标签筛选（只剩带该标签的笔记）',
    await waitEval(
      `document.querySelectorAll('.note-title').length === 1 && document.querySelector('.note-title').textContent === '独门笔记'`,
      8000,
    ),
  );
  check(
    '列表头显示当前筛选的标签名',
    await evaluate(`document.querySelector('.list-head h2').textContent.includes('工作')`),
  );
  await evaluate(
    `[...document.querySelectorAll('#tagbar .tag-chip')].find((c) => c.dataset.tag === '工作').click()`,
  );
  check(
    '再点同一标签筛选保持（幂等，不会莫名清空）',
    await waitEval(
      `document.querySelector('#tag-clear') && document.querySelectorAll('.note-title').length === 1`,
      6000,
    ),
  );
  await evaluate(`document.querySelector('#tag-clear').click()`);
  check('点“清除标签”退出筛选', await waitEval(`!document.querySelector('#tag-clear')`, 6000));
  console.log(
    '      [diag-clear]',
    JSON.stringify(await evaluate(`window.__diag ? window.__diag() : 'no hook'`)),
  );
  await evaluate(
    `[...document.querySelectorAll('#tagbar .tag-chip')].find((c) => c.dataset.tag === '重要').click()`,
  );
  await waitEval(`document.querySelectorAll('.note-title').length === 1`, 8000);
  await evaluate(
    `document.querySelector('#tag-editor .tag-chip[data-tag="重要"] .tag-remove').click()`,
  );
  check(
    '移除标签后该标签筛选自动退出',
    await waitEval(`!document.querySelector('#tagbar .tag-chip[data-tag="重要"]')`, 8000),
  );

  // 5.6) 置顶：编辑区按钮 + 右键菜单 + 列表分区 + 重载保持
  check('编辑区出现置顶按钮', await waitEval(`!!document.querySelector('#pin-toggle')`));
  await evaluate(`document.querySelector('#pin-toggle').click()`);
  check(
    '置顶按钮变为已置顶',
    await waitEval(`document.querySelector('#pin-toggle').textContent.includes('已置顶')`, 8000),
  );
  check(
    '列表首行即该笔记并显示置顶徽标',
    await waitEval(
      `(() => { const row = document.querySelector('.note-row'); return !!row && !!row.querySelector('.badge-pin') && row.querySelector('.note-title').textContent === '独门笔记'; })()`,
      8000,
    ),
  );
  check(
    '列表头显示置顶条数',
    await evaluate(`document.querySelector('.list-sub').textContent.includes('置顶')`),
  );
  // 只断言右键菜单里有“取消置顶”，不点它（点了会真的取消置顶，把后面的断言带偏）
  await evaluate(
    `window.__ctxAt([...document.querySelectorAll('.note-title')].find((n) => n.textContent === '独门笔记').closest('.note-row'))`,
  );
  check(
    '行右键出现“取消置顶”',
    await waitEval(
      `[...document.querySelectorAll('.ctx-item')].some((b) => b.textContent.includes('取消置顶'))`,
      4000,
    ),
  );
  await evaluate(
    `document.querySelector('.ctx-menu').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`,
  );
  check(
    '关菜单后置顶徽标仍在（菜单未误改状态）',
    await waitEval(`!!document.querySelector('.badge-pin')`, 4000),
  );
  await send('Page.reload', { ignoreCache: true });
  await waitEval('window.__ready()', 25000);
  check(
    '置顶在重载后仍生效',
    await waitEval(
      `window.__ready() && (() => { const row = document.querySelector('.note-row'); return !!row && !!row.querySelector('.badge-pin'); })()`,
      25000,
    ),
  );
  await evaluate(
    `[...document.querySelectorAll('.note-title')].find((n) => n.textContent === '独门笔记').closest('.note-row').click()`,
  );
  check(
    '打开后置顶按钮仍为已置顶',
    await waitEval(
      `document.querySelector('#pin-toggle') && document.querySelector('#pin-toggle').textContent.includes('已置顶')`,
      8000,
    ),
  );
  await evaluate(`document.querySelector('#pin-toggle').click()`);
  check('取消置顶后徽标消失', await waitEval(`!document.querySelector('.badge-pin')`, 8000));

  // 5.7) 格式工具栏：按钮生效 / 撤销重做 / 高亮渲染 / 更多折叠
  check(
    '格式工具栏渲染（分组 + 按钮）',
    await waitEval(
      `!!document.querySelector('#format-bar') && !!document.querySelector('#fmt-bold') && document.querySelectorAll('#format-bar .fmt-group').length >= 5`,
      8000,
    ),
  );
  check(
    '工具栏含加粗/斜体/标题/列表/代码块/链接/表格',
    await evaluate(
      `['bold','italic','strike','highlight','h1','h2','h3','bullet','ordered','todo','quote','code-block','link','table'].every((id) => !!document.querySelector('#fmt-' + id))`,
    ),
  );

  const editorValue = `document.querySelector('#editor').value`;
  /** 选中 [from,to) 后点某个格式按钮，返回新的正文 */
  const selFmt = async (from, to, id) => {
    await evaluate(
      `(() => { const ta = document.querySelector('#editor'); ta.focus(); ta.setSelectionRange(${from}, ${to}); return true; })()`,
    );
    await evaluate(`document.querySelector('#fmt-${id}').click()`);
    await new Promise((r) => setTimeout(r, 150));
    return await evaluate(editorValue);
  };
  // 全文逐字比对：能拦住“插入而非替换”这类只在局部看起来对的缺陷
  const fmtBody = await evaluate(editorValue);
  const boldExpected = `**${fmtBody.slice(0, 2)}**${fmtBody.slice(2)}`;
  const hlExpected = `==${fmtBody.slice(0, 2)}==${fmtBody.slice(2)}`;

  const bolded = await selFmt(0, 2, 'bold');
  check(
    '加粗：恰好给选中文字包上 ** （未重复拼接）',
    bolded === boldExpected,
    `${JSON.stringify(bolded)} vs ${JSON.stringify(boldExpected)}`,
  );

  await evaluate(`document.querySelector('#fmt-undo').click()`);
  check(
    '撤销按钮回退加粗（原生撤销栈可用）',
    await waitEval(`${editorValue} === ${JSON.stringify(fmtBody)}`, 6000),
  );
  await evaluate(`document.querySelector('#fmt-redo').click()`);
  check(
    '重做按钮恢复加粗',
    await waitEval(`${editorValue} === ${JSON.stringify(boldExpected)}`, 6000),
  );
  await evaluate(`document.querySelector('#fmt-undo').click()`);
  await waitEval(`${editorValue} === ${JSON.stringify(fmtBody)}`, 6000);

  const highlighted = await selFmt(0, 2, 'highlight');
  check(
    '高亮：恰好给选中文字包上 == （未重复拼接）',
    highlighted === hlExpected,
    `${JSON.stringify(highlighted)} vs ${JSON.stringify(hlExpected)}`,
  );
  check(
    '预览把 ==文字== 渲染为高亮（<mark>）',
    await waitEval(`!!document.querySelector('#preview mark')`, 8000),
  );
  check(
    '预览里高亮内容正确',
    await evaluate(
      `document.querySelector('#preview mark').textContent === ${JSON.stringify(fmtBody.slice(0, 2))}`,
    ),
  );

  // 行首前缀类最容易暴露“插入而非替换”：整行必须原样保留，只多一个前缀
  await evaluate(
    `(() => { const ta = document.querySelector('#editor'); ta.focus(); ta.setSelectionRange(0, 0); return true; })()`,
  );
  await evaluate(`document.querySelector('#fmt-h1').click()`);
  await new Promise((r) => setTimeout(r, 150));
  const h1On = await evaluate(editorValue);
  check(
    'H1：行首加 # 且整行未被复制',
    h1On === `# ${hlExpected}`,
    `${JSON.stringify(h1On)} vs ${JSON.stringify(`# ${hlExpected}`)}`,
  );
  await evaluate(`document.querySelector('#fmt-h1').click()`);
  await new Promise((r) => setTimeout(r, 150));
  const h1Off = await evaluate(editorValue);
  check(
    'H1 再点一次完全还原',
    h1Off === hlExpected,
    `${JSON.stringify(h1Off)} vs ${JSON.stringify(hlExpected)}`,
  );

  // 清理高亮，避免影响后续「回收站」等断言（只选被高亮的那一段，而不是整行）
  const hlSpanEnd = hlExpected.indexOf('==', 2) + 2;
  const cleared = await selFmt(0, hlSpanEnd, 'highlight');
  check(
    '高亮可被取消（回到原文）',
    cleared === fmtBody,
    `${JSON.stringify(cleared)} vs ${JSON.stringify(fmtBody)}`,
  );

  // 「⋯ 更多」折叠区
  await evaluate(`document.querySelector('#fmt-more').click()`);
  check(
    '「⋯ 更多」展开折叠面板（含行内代码/分隔线）',
    await waitEval(
      `!!document.querySelector('#fmt-more-panel') && !!document.querySelector('#fmt-inline-code') && !!document.querySelector('#fmt-hr')`,
      5000,
    ),
  );
  await evaluate(`document.querySelector('#fmt-more').click()`);
  check('再点收起折叠面板', await waitEval(`!document.querySelector('#fmt-more-panel')`, 5000));
  await evaluate(
    `[...document.querySelectorAll('#mode-seg button')].find((x) => x.textContent.includes('预览')).click()`,
  );
  check(
    '工具栏在「预览」视图下隐藏',
    await waitEval(`!document.querySelector('#format-bar')`, 5000),
  );
  await evaluate(
    `[...document.querySelectorAll('#mode-seg button')].find((x) => x.textContent.includes('编辑')).click()`,
  );
  check(
    '切回编辑视图后工具栏回来',
    await waitEval(`!!document.querySelector('#format-bar')`, 5000),
  );

  // 5.8) 布局：宽度按可见内容分配 + 可拖拽分隔条 + 不留白
  const wsW = `Math.round(document.querySelector('.workspace').getBoundingClientRect().width)`;
  const edW = `Math.round(document.querySelector('.editor').getBoundingClientRect().width)`;
  const pvW = `Math.round(document.querySelector('.preview').getBoundingClientRect().width)`;
  const setMode = async (t) => {
    await evaluate(
      `[...document.querySelectorAll('#mode-seg button')].find((b) => b.textContent.includes(${JSON.stringify(t)})).click()`,
    );
    await new Promise((r) => setTimeout(r, 320));
  };

  await setMode('分屏');
  const splitEd = await evaluate(edW);
  const splitPv = await evaluate(pvW);
  check(
    '分屏：编辑/预览各占一半',
    Math.abs(splitEd - splitPv) <= 12 && splitEd > 60,
    `${splitEd} / ${splitPv}`,
  );
  check(
    '分屏：出现可拖拽分隔条',
    await waitEval(`!!document.querySelector('#split-handle')`, 4000),
  );

  await setMode('预览');
  const pvOnly = await evaluate(pvW);
  const pvOnlyWs = await evaluate(wsW);
  check(
    '仅预览：预览占满整宽（不再只占一半）',
    pvOnly === pvOnlyWs,
    `${pvOnly} vs workspace ${pvOnlyWs}`,
  );

  await setMode('编辑');
  const edOnly = await evaluate(edW);
  const edOnlyWs = await evaluate(wsW);
  check(
    '仅编辑：编辑器占满整宽（不再只占一半）',
    edOnly === edOnlyWs,
    `${edOnly} vs workspace ${edOnlyWs}`,
  );

  await setMode('分屏');
  await evaluate(`(() => {
    const h = document.querySelector('#split-handle');
    const wr = h.parentElement.getBoundingClientRect();
    const r = h.getBoundingClientRect();
    const mk = (type, x) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: r.top + 8 });
    h.dispatchEvent(mk('pointerdown', r.left + 3));
    h.dispatchEvent(mk('pointermove', wr.left + wr.width * 0.8));
    h.dispatchEvent(mk('pointerup', wr.left + wr.width * 0.8));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 550));
  const dragEd = await evaluate(edW);
  check('拖动分隔条改变编辑/预览比例', dragEd > splitEd + 30, `${splitEd} → ${dragEd}`);
  check(
    '拖后的比例写入设置（可持久化）',
    await waitEval(
      `(() => { const raw = localStorage.getItem('noteapp.settings.v1'); if (!raw) return false; const r = Number(JSON.parse(raw).editor.splitRatio); return Number.isFinite(r) && r > 0.6; })()`,
      4000,
    ),
  );

  await evaluate(
    `document.querySelector('#split-handle').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`,
  );
  await new Promise((r) => setTimeout(r, 400));
  const resetEd = await evaluate(edW);
  const resetPv = await evaluate(pvW);
  check(
    '双击分隔条恢复各半',
    Math.abs(resetEd - resetPv) <= 12 && resetEd > 60,
    `${resetEd} / ${resetPv}`,
  );
  check(
    '内容填满窗口（右侧不留白）',
    await evaluate(
      `Math.round(document.querySelector('.app-shell').getBoundingClientRect().width) === window.innerWidth`,
    ),
  );

  await evaluate(`[...document.querySelectorAll('.ed-right .btn-danger')][0].click()`);
  check(
    '删除需二次确认（进回收站文案）',
    await waitEval(
      `!!document.querySelector('.modal-card') && document.body.textContent.includes('回收站')`,
    ),
  );
  check(
    '弹窗宽度未被边框撑宽（≤440）',
    await evaluate(
      `(() => { const r = document.querySelector('.modal-card').getBoundingClientRect(); return r.width > 420 && r.width <= 440; })()`,
    ),
  );
  await evaluate(
    `[...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent.includes('移入回收站')).click()`,
  );
  await evaluate(
    `[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('回收站') && n.textContent.includes('🗑️')).click()`,
  );
  check(
    '回收站显示已删笔记',
    await waitEval(
      `[...document.querySelectorAll('.note-title')].some((n) => n.textContent === '独门笔记')`,
    ),
  );
  await evaluate(
    `[...document.querySelectorAll('.note-title')].find((n) => n.textContent === '独门笔记').closest('.note-row').click()`,
  );
  check(
    '回收站只读横幅',
    await waitEval(
      `!!document.querySelector('.trash-banner') && !!document.querySelector('.title-input[readonly]')`,
    ),
  );
  await evaluate(
    `[...document.querySelectorAll('.trash-banner button')].find((b) => b.textContent.includes('还原')).click()`,
  );
  check('还原后可编辑', await waitEval(`!document.querySelector('.trash-banner')`));

  // 6) 右键行 → 移入回收站 → 回收站右键还原
  await evaluate(
    `[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('全部笔记')).click()`,
  );
  check(
    '还原后回到全部视图可见',
    await waitEval(
      `[...document.querySelectorAll('.note-title')].some((n) => n.textContent === '独门笔记')`,
    ),
  );
  check(
    '行右键“移入回收站”',
    await pickCtxItem(
      `[...document.querySelectorAll('.note-title')].find((n) => n.textContent === '独门笔记').closest('.note-row')`,
      '移入回收站',
    ),
  );
  check('出现确认框', await waitEval(`!!document.querySelector('.modal-card')`, 4000));
  await evaluate(
    `[...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent.includes('移入回收站')).click()`,
  );
  await evaluate(
    `[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('回收站') && n.textContent.includes('🗑️')).click()`,
  );
  check(
    '回收站视图显示已删笔记',
    await waitEval(
      `[...document.querySelectorAll('.note-title')].some((n) => n.textContent === '独门笔记')`,
    ),
  );
  check(
    '回收站行右键“还原”',
    await pickCtxItem(
      `[...document.querySelectorAll('.note-title')].find((n) => n.textContent === '独门笔记').closest('.note-row')`,
      '还原',
    ),
  );
  await evaluate(
    `[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('全部笔记')).click()`,
  );
  check(
    '还原后全部可见',
    await waitEval(
      `[...document.querySelectorAll('.note-title')].some((n) => n.textContent === '独门笔记')`,
    ),
  );

  // 6.5) 拖拽：文件夹排序、笔记拖入文件夹、文件夹删除进回收站并还原
  async function dndFolder(fromName, toName, yTop) {
    return await evaluate(`(() => {
      const src = [...document.querySelectorAll('.folder-main')].find((b) => b.textContent.includes(${JSON.stringify(fromName)}));
      const dst = [...document.querySelectorAll('.folder-main')].find((b) => b.textContent.includes(${JSON.stringify(toName)}));
      if (!src || !dst) return false;
      const sr = src.getBoundingClientRect(); const dr = dst.getBoundingClientRect();
      const sx = sr.left + sr.width / 2, sy = sr.top + sr.height / 2;
      src.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: sx, clientY: sy, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: sx + 24, clientY: sy + 12, pointerId: 1 }));
      const tx = dr.left + dr.width / 2, ty = dr.top + (${yTop} ? 2 : dr.height - 2);
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: tx, clientY: ty, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: tx, clientY: ty, pointerId: 1 }));
      return true;
    })()`);
  }
  async function dndNoteToFolder(noteTitle, folderName) {
    return await evaluate(`(() => {
      const row = [...document.querySelectorAll('.note-row')].find((r) => r.textContent.includes(${JSON.stringify(noteTitle)}));
      const dst = [...document.querySelectorAll('.folder-main')].find((b) => b.textContent.includes(${JSON.stringify(folderName)}));
      if (!row || !dst) return false;
      const rr = row.getBoundingClientRect(); const dr = dst.getBoundingClientRect();
      const sx = rr.left + rr.width / 2, sy = rr.top + rr.height / 2;
      row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: sx, clientY: sy, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: sx + 24, clientY: sy + 12, pointerId: 1 }));
      const tx = dr.left + dr.width / 2, ty = dr.top + 2;
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: tx, clientY: ty, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: tx, clientY: ty, pointerId: 1 }));
      return true;
    })()`);
  }

  await evaluate(
    `[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('全部笔记')).click()`,
  );
  await waitEval(`[...document.querySelectorAll('.folder-name')].length >= 2`);
  check('文件夹拖拽排序（工作甲移到收件箱前）', await dndFolder('工作甲', '收件箱', true));
  check(
    '拖拽后顺序生效',
    await waitEval(`[...document.querySelectorAll('.folder-name')][0]?.textContent === '工作甲'`),
  );
  check('笔记拖入文件夹（独门笔记→工作甲）', await dndNoteToFolder('独门笔记', '工作甲'));
  await waitEval(
    `[...document.querySelectorAll('.note-title')].some((n) => n.textContent === '独门笔记')`,
  );
  await evaluate(
    `[...document.querySelectorAll('.note-title')].find((n) => n.textContent === '独门笔记').closest('.note-row').click()`,
  );
  check(
    '拖入后所在文件夹更新为「工作甲」',
    await waitEval(
      `document.querySelector('.folder-chip') && document.querySelector('.folder-chip').value === '工作甲'`,
    ),
  );

  check(
    '文件夹右键删除进回收站',
    await pickCtxItem(
      `[...document.querySelectorAll('.folder-item')].find((f) => f.textContent.includes('工作甲'))`,
      '删除（移入回收站）',
    ),
  );
  await waitEval(`!!document.querySelector('.modal-card')`, 4000);
  await evaluate(
    `[...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent.includes('移入回收站')).click()`,
  );
  check(
    '文件夹从侧栏移除',
    await waitEval(
      `![...document.querySelectorAll('.folder-name')].some((n) => n.textContent === '工作甲')`,
    ),
  );
  await evaluate(
    `[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('回收站') && n.textContent.includes('🗑️')).click()`,
  );
  check(
    '回收站出现已删除文件夹',
    await waitEval(
      `[...document.querySelectorAll('.trash-folder .folder-name')].some((n) => n.textContent === '工作甲')`,
    ),
  );
  check(
    '文件夹右键还原',
    await pickCtxItem(
      `[...document.querySelectorAll('.trash-folder')].find((f) => f.textContent.includes('工作甲'))`,
      '还原文件夹',
    ),
  );
  await evaluate(
    `[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('全部笔记')).click()`,
  );
  check(
    '文件夹与其中笔记已还原',
    await waitEval(
      `[...document.querySelectorAll('.folder-name')].some((n) => n.textContent === '工作甲') && [...document.querySelectorAll('.note-title')].some((n) => n.textContent === '独门笔记')`,
    ),
  );

  // 7) 再造一条 → 多选批量移入回收站
  await pickCtxItem(`document.querySelector('.nav-scroll')`, '新建文件夹');
  await waitEval(`!!document.querySelector('.prompt-input')`);
  await evaluate(`window.__setValue(document.querySelector('.prompt-input'), '读书')`);
  await evaluate(`[...document.querySelectorAll('.modal-actions button')].at(-1).click()`);
  await waitEval(
    `[...document.querySelectorAll('.folder-name')].some((n) => n.textContent === '读书')`,
  );
  check(
    '文件夹右键新建第二条',
    await pickCtxItem(
      `[...document.querySelectorAll('.folder-item')].find((f) => f.textContent.includes('读书'))`,
      '中新建笔记',
    ),
  );
  await waitEval(`!!document.querySelector('.title-input')`);
  await evaluate(`window.__setValue(document.querySelector('.title-input'), '读书笔记')`);
  await evaluate(`window.__setValue(document.querySelector('#editor'), '读书正文')`);
  await waitEval(
    `document.querySelector('.save-status') && document.querySelector('.save-status').textContent.includes('已保存')`,
    9000,
  );

  await evaluate(
    `[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('全部笔记')).click()`,
  );
  await waitEval(`document.querySelectorAll('.note-row').length >= 2`);

  // 6.8) 列表内拖拽手排 + 一键恢复时间序
  const beforeOrder = await evaluate(
    `JSON.stringify([...document.querySelectorAll('.note-title')].map((n) => n.textContent))`,
  );
  const rowDrag = await evaluate(`(() => {
    const rows = [...document.querySelectorAll('.note-row')];
    if (rows.length < 2) return false;
    const r1 = rows[1].getBoundingClientRect();
    const r0 = rows[0].getBoundingClientRect();
    const sx = r1.left + r1.width / 2, sy = r1.top + r1.height / 2;
    rows[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: sx, clientY: sy, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: sx + 24, clientY: sy + 12, pointerId: 1 }));
    const tx = r0.left + r0.width / 2, ty = r0.top + 2;
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: tx, clientY: ty, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: tx, clientY: ty, pointerId: 1 }));
    return true;
  })()`);
  check('列表内拖拽发生', !!rowDrag);
  await waitEval(
    `JSON.stringify([...document.querySelectorAll('.note-title')].map((n) => n.textContent)) !== ${JSON.stringify(beforeOrder)}`,
  );
  check(
    '拖拽后顺序变化（手排生效）',
    await waitEval(
      `document.querySelector('.list-sub') && document.querySelector('.list-sub').textContent.includes('手动排序')`,
    ),
  );
  check(
    '出现“恢复时间序”入口',
    await waitEval(
      `[...document.querySelectorAll('.chip-btn')].some((b) => b.textContent.includes('恢复时间序'))`,
    ),
  );
  await evaluate(
    `[...document.querySelectorAll('.chip-btn')].find((b) => b.textContent.includes('恢复时间序')).click()`,
  );
  check(
    '恢复后回到时间序',
    await waitEval(
      `JSON.stringify([...document.querySelectorAll('.note-title')].map((n) => n.textContent)) === ${JSON.stringify(beforeOrder)}`,
    ),
  );

  // 7.5) 待办聚合视图：汇总 → 勾选回写 → 显示已完成 → 跳回源笔记
  check(
    '待办入口存在',
    await waitEval(
      `[...document.querySelectorAll('.nav-item')].some((n) => n.textContent.includes('待办'))`,
    ),
  );
  // 新建一篇带任务的笔记（新笔记默认落收件箱，正文写两条任务）
  await evaluate(`document.querySelector('.sidebar .btn-primary').click()`);
  await waitEval(`!!document.querySelector('#editor')`, 8000);
  await evaluate(
    `window.__setValue(document.querySelector('#editor'), '- [ ] 写周报\\n- [ ] 买牛奶')`,
  );
  await evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }))`,
  );
  await waitEval(
    `document.querySelector('.save-status') && document.querySelector('.save-status').textContent.includes('已保存')`,
    9000,
  );
  await evaluate(
    `[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('待办')).click()`,
  );
  check(
    '待办视图渲染任务行',
    await waitEval(`document.querySelectorAll('.todo-row').length >= 2`, 8000),
  );
  check(
    '任务行显示来源笔记与文件夹',
    await waitEval(
      `[...document.querySelectorAll('.todo-meta')].some((m) => m.textContent.includes('收件箱'))`,
    ),
  );
  // 勾选「买牛奶」→ 未完成清单里消失，并可切换显示已完成
  await evaluate(
    `(() => { const row = [...document.querySelectorAll('.todo-row')].find((r) => r.textContent.includes('买牛奶')); row.querySelector('.todo-check').click(); return true; })()`,
  );
  check(
    '勾选后从未完成清单消失（已回写源文）',
    await waitEval(
      `![...document.querySelectorAll('.todo-text')].some((t) => t.textContent === '买牛奶')`,
      8000,
    ),
  );
  check(
    '出现「显示已完成」入口',
    await waitEval(`!!document.querySelector('#todo-show-done')`, 4000),
  );
  await evaluate(`document.querySelector('#todo-show-done').click()`);
  check(
    '显示已完成后能看到已完成项且带删除线',
    await waitEval(
      `[...document.querySelectorAll('.todo-row.done .todo-text')].some((t) => t.textContent === '买牛奶')`,
      6000,
    ),
  );
  // 跳回源笔记：编辑区展开且定位到该行
  await evaluate(
    `[...document.querySelectorAll('.todo-text')].find((t) => t.textContent === '写周报').click()`,
  );
  check(
    '点击任务跳回源笔记',
    await waitEval(
      `!!document.querySelector('.editor-pane.open') && document.querySelector('#editor') && document.querySelector('#editor').value.includes('写周报')`,
      8000,
    ),
  );
  check(
    '跳转后编辑器高亮该行',
    await waitEval(`!!document.querySelector('#editor.todo-flash')`, 4000),
  );
  await evaluate(
    `[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('全部笔记')).click()`,
  );
  check(
    '回到全部笔记视图',
    await waitEval(
      `[...document.querySelectorAll('.note-title')].some((n) => n.textContent.includes('读书'))`,
      8000,
    ),
  );

  await evaluate(
    `[...document.querySelectorAll('.chip-btn')].find((b) => b.textContent.includes('选择')).click()`,
  );
  check('出现多选条', await waitEval(`!!document.querySelector('.selbar')`));
  await evaluate(
    `[...document.querySelectorAll('.selbar button')].find((b) => b.textContent.includes('全选')).click()`,
  );
  check(
    '已选计数 ≥2',
    await waitEval(
      `Number(document.querySelector('.sel-count').textContent.replace(/[^0-9]/g, '')) >= 2`,
    ),
  );
  await evaluate(`[...document.querySelectorAll('.selbar .btn-danger')][0].click()`);
  await waitEval(`!!document.querySelector('.modal-card')`);
  await evaluate(
    `[...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent.includes('移入回收站')).click()`,
  );
  check(
    '批量后回收站 ≥2',
    await waitEval(
      `Number([...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('回收站')).textContent.replace(/[^0-9]/g, '')) >= 2`,
    ),
  );

  // 8) 面板级联：默认图3 → 手柄展开/收回
  await evaluate(
    `[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('全部笔记')).click()`,
  );
  check(
    '点“全部笔记”滑出笔记列（图4）',
    await waitEval(`!!document.querySelector('.list-pane.open')`),
  );
  check(
    '展开后内容宽度加宽（触发窗口缩放）',
    await evaluate(`document.querySelector('.app-shell').getBoundingClientRect().width >= 480`),
  );
  // 手柄收回笔记列 → 图3
  await evaluate(`document.querySelector('.seam-a').click()`);
  check(
    '手柄收回笔记列（图3）',
    await waitEval(
      `!document.querySelector('.list-pane.open') && !document.querySelector('.editor-pane.open')`,
    ),
  );
  // 图3 的“窗口收窄”由桌面端 setSize 负责（Web 预览下 window 不能缩）；
  // 这里断言的是内容侧确实回到了只有侧栏：两个面板宽度为 0，只剩侧栏 224。
  check(
    '收回后只剩侧栏（列表/编辑区宽度为 0）',
    await evaluate(
      `(() => { const l = document.querySelector('.list-pane').getBoundingClientRect().width; const e = document.querySelector('.editor-pane').getBoundingClientRect().width; return l === 0 && e === 0; })()`,
    ),
  );
  check(
    '收回后侧栏宽度≈224',
    await evaluate(
      `Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width - 224) <= 2`,
    ),
  );
  // 再展开笔记列
  await evaluate(`document.querySelector('.seam-a').click()`);
  check('手柄再次展开笔记列', await waitEval(`!!document.querySelector('.list-pane.open')`));
  // 展开/收回编辑区（图4 ⇄ 图5）
  await evaluate(`document.querySelector('.seam-b').click()`);
  check('手柄展开编辑区（图5）', await waitEval(`!!document.querySelector('.editor-pane.open')`));
  await evaluate(`document.querySelector('.seam-b').click()`);
  check(
    '手柄收回编辑区（图4）',
    await waitEval(
      `!document.querySelector('.editor-pane.open') && !!document.querySelector('.list-pane.open')`,
    ),
  );

  // 9) 全局搜索命中回收站
  await evaluate(`window.__setValue(document.querySelector('.searchbox input'), '读书笔记')`);
  check(
    '搜索含回收站命中',
    await waitEval(
      `[...document.querySelectorAll('.note-row .note-title')].some((n) => n.textContent.includes('读书笔记'))`,
    ),
  );
  await evaluate(`window.__setValue(document.querySelector('.searchbox input'), '')`);

  const errs = JSON.parse((await evaluate(`JSON.stringify(window.__errs || [])`)) || '[]');
  check('无未捕获页面错误', errs.length === 0, errs.join(' | '));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n冒烟结果：${results.length - failed}/${results.length} 通过`);
try {
  await fetch(`${BASE}/json/close/${target.id}`);
} catch {
  /* ignore */
}
ws.close();
process.exit(failed ? 1 : 0);
