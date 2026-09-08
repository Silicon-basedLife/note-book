// scripts/ui-smoke.mjs —— 真实 Chrome（CDP）端到端冒烟（增强版 UI）
// 前置：带 --remote-debugging-port=9222 的 headless Chrome（独立 user-data-dir）＋静态托管 web/dist。
// 运行：SMOKE_URL=... CDP_PORT=... node scripts/ui-smoke.mjs
import WebSocket from 'ws';

const DEBUG = process.env.CDP_PORT || '9222';
const APP_URL = process.env.SMOKE_URL || 'http://localhost:5174/';
const BASE = `http://127.0.0.1:${DEBUG}`;

const target = await (async () => {
  const resp = await fetch(`${BASE}/json/new?about:blank`, { method: 'PUT' });
  if (!resp.ok) throw new Error(`CDP 不可用 (${resp.status})：请先启动 --remote-debugging-port=${DEBUG} 的 Chrome`);
  return resp.json();
})();

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
let seq = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  if (!msg.id || !pending.has(msg.id)) return;
  const p = pending.get(msg.id); pending.delete(msg.id);
  msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
});
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
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
    try { if (await evaluate(expression)) return true; } catch { /* ignore */ }
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
  const okItem = await waitEval(`[...document.querySelectorAll('.ctx-item')].some((b) => b.textContent.includes(${JSON.stringify(itemText)}))`, 3000);
  if (!okItem) {
    console.log('      [ctx items]', await evaluate(`JSON.stringify([...document.querySelectorAll('.ctx-item')].map((b) => b.textContent))`));
    return false;
  }
  await evaluate(`[...document.querySelectorAll('.ctx-item')].find((b) => b.textContent.includes(${JSON.stringify(itemText)})).click()`);
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Page.navigate', { url: APP_URL });
check('启动并渲染主界面', await waitEval('window.__ready()', 25000));

if (await evaluate('window.__ready()')) {
  // 1) 空白右键 → 新建文件夹「工作」
  await evaluate(`(() => { const el = document.querySelector('.nav-scroll'); if (!el) return false; window.__ctxAt(el); return true; })()`);
  check('空白处右键出菜单', await waitEval(`!!document.querySelector('.ctx-menu')`));
  await sleep(120);
  check('菜单项“新建文件夹”可点', await pickCtxItem(`document.querySelector('.nav-scroll')`, '新建文件夹') === true);
  check('出现命名输入框', await waitEval(`!!document.querySelector('.prompt-input')`));
  await evaluate(`window.__setValue(document.querySelector('.prompt-input'), '工作')`);
  await evaluate(`[...document.querySelectorAll('.modal-actions button')].at(-1).click()`);
  check('文件夹「工作」已创建', await waitEval(`[...document.querySelectorAll('.folder-name')].some((n) => n.textContent === '工作')`));

  // 2) 文件夹右键 → 在其中新建笔记
  check('文件夹右键“在其中新建笔记”', await pickCtxItem(`[...document.querySelectorAll('.folder-item')].find((f) => f.textContent.includes('工作'))`, '中新建笔记'));
  check('进入编辑态', await waitEval(`!!document.querySelector('.title-input') && !!document.querySelector('#editor')`));

  // 3) 书写 → 自动保存
  await evaluate(`window.__setValue(document.querySelector('.title-input'), '独门笔记')`);
  await evaluate(`window.__setValue(document.querySelector('#editor'), '内容包含暗号KDX2026')`);
  check('自动保存“已保存”', await waitEval(`document.querySelector('.save-status') && document.querySelector('.save-status').textContent.includes('已保存')`, 9000));
  check('标题同步列表', await waitEval(`[...document.querySelectorAll('.note-title')].some((n) => n.textContent === '独门笔记')`));

  // 4) 双击文件夹重命名 工作 → 工作甲
  await evaluate(`(() => { const n = [...document.querySelectorAll('.folder-name')].find((x) => x.textContent === '工作'); if (!n) return false; n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); return true; })()`);
  check('双击进入重命名', await waitEval(`!!document.querySelector('.folder-rename input')`));
  await evaluate(`window.__setValue(document.querySelector('.folder-rename input'), '工作甲')`);
  await evaluate(`document.querySelector('.folder-rename input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  check('重命名为「工作甲」', await waitEval(`[...document.querySelectorAll('.folder-name')].some((n) => n.textContent === '工作甲')`));

  // 5) 回收站：删除 → 只读视图 → 还原
  await evaluate(`[...document.querySelectorAll('.note-title')].find((n) => n.textContent === '独门笔记').closest('.note-row').click()`);
  await waitEval(`document.querySelector('.title-input') && document.querySelector('.title-input').value === '独门笔记'`);
  await evaluate(`[...document.querySelectorAll('.ed-right .btn-danger')][0].click()`);
  check('删除需二次确认（进回收站文案）', await waitEval(`!!document.querySelector('.modal-card') && document.body.textContent.includes('回收站')`));
  await evaluate(`[...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent.includes('移入回收站')).click()`);
  await evaluate(`[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('回收站') && n.textContent.includes('🗑️')).click()`);
  check('回收站显示已删笔记', await waitEval(`[...document.querySelectorAll('.note-title')].some((n) => n.textContent === '独门笔记')`));
  await evaluate(`[...document.querySelectorAll('.note-title')].find((n) => n.textContent === '独门笔记').closest('.note-row').click()`);
  check('回收站只读横幅', await waitEval(`!!document.querySelector('.trash-banner') && !!document.querySelector('.title-input[readonly]')`));
  await evaluate(`[...document.querySelectorAll('.trash-banner button')].find((b) => b.textContent.includes('还原')).click()`);
  check('还原后可编辑', await waitEval(`!document.querySelector('.trash-banner')`));

  // 6) 右键行 → 移入回收站 → 回收站右键还原
  await evaluate(`[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('全部笔记')).click()`);
  check('还原后回到全部视图可见', await waitEval(`[...document.querySelectorAll('.note-title')].some((n) => n.textContent === '独门笔记')`));
  check('行右键“移入回收站”', await pickCtxItem(`[...document.querySelectorAll('.note-title')].find((n) => n.textContent === '独门笔记').closest('.note-row')`, '移入回收站'));
  check('出现确认框', await waitEval(`!!document.querySelector('.modal-card')`, 4000));
  await evaluate(`[...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent.includes('移入回收站')).click()`);
  await evaluate(`[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('回收站') && n.textContent.includes('🗑️')).click()`);
  check('回收站视图显示已删笔记', await waitEval(`[...document.querySelectorAll('.note-title')].some((n) => n.textContent === '独门笔记')`));
  check('回收站行右键“还原”', await pickCtxItem(`[...document.querySelectorAll('.note-title')].find((n) => n.textContent === '独门笔记').closest('.note-row')`, '还原'));
  await evaluate(`[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('全部笔记')).click()`);
  check('还原后全部可见', await waitEval(`[...document.querySelectorAll('.note-title')].some((n) => n.textContent === '独门笔记')`));

  // 7) 再造一条 → 多选批量移入回收站
  await pickCtxItem(`document.querySelector('.nav-scroll')`, '新建文件夹');
  await waitEval(`!!document.querySelector('.prompt-input')`);
  await evaluate(`window.__setValue(document.querySelector('.prompt-input'), '读书')`);
  await evaluate(`[...document.querySelectorAll('.modal-actions button')].at(-1).click()`);
  await waitEval(`[...document.querySelectorAll('.folder-name')].some((n) => n.textContent === '读书')`);
  check('文件夹右键新建第二条', await pickCtxItem(`[...document.querySelectorAll('.folder-item')].find((f) => f.textContent.includes('读书'))`, '中新建笔记'));
  await waitEval(`!!document.querySelector('.title-input')`);
  await evaluate(`window.__setValue(document.querySelector('.title-input'), '读书笔记')`);
  await evaluate(`window.__setValue(document.querySelector('#editor'), '读书正文')`);
  await waitEval(`document.querySelector('.save-status') && document.querySelector('.save-status').textContent.includes('已保存')`, 9000);

  await evaluate(`[...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('全部笔记')).click()`);
  await waitEval(`document.querySelectorAll('.note-row').length >= 2`);
  await evaluate(`[...document.querySelectorAll('.chip-btn')].find((b) => b.textContent.includes('选择')).click()`);
  check('出现多选条', await waitEval(`!!document.querySelector('.selbar')`));
  await evaluate(`[...document.querySelectorAll('.selbar button')].find((b) => b.textContent.includes('全选')).click()`);
  check('已选计数 ≥2', await waitEval(`Number(document.querySelector('.sel-count').textContent.replace(/[^0-9]/g, '')) >= 2`));
  await evaluate(`[...document.querySelectorAll('.selbar .btn-danger')][0].click()`);
  await waitEval(`!!document.querySelector('.modal-card')`);
  await evaluate(`[...document.querySelectorAll('.modal-actions button')].find((b) => b.textContent.includes('移入回收站')).click()`);
  check('批量后回收站 ≥2', await waitEval(`Number([...document.querySelectorAll('.nav-item')].find((n) => n.textContent.includes('回收站')).textContent.replace(/[^0-9]/g, '')) >= 2`));

  // 8) 收边窄条
  await evaluate(`document.querySelector('.sb-collapse').click()`);
  check('出现收边窄条', await waitEval(`!!document.querySelector('.rail')`));
  await evaluate(`[...document.querySelectorAll('.rail-item')].find((b) => b.textContent.includes('全部笔记')).click()`);
  check('点窄条项恢复侧栏', await waitEval(`!document.querySelector('.rail')`));

  // 9) 全局搜索命中回收站
  await evaluate(`window.__setValue(document.querySelector('.searchbox input'), '读书笔记')`);
  check('搜索含回收站命中', await waitEval(`[...document.querySelectorAll('.note-row .note-title')].some((n) => n.textContent.includes('读书笔记'))`));
  await evaluate(`window.__setValue(document.querySelector('.searchbox input'), '')`);

  const errs = JSON.parse(await evaluate(`JSON.stringify(window.__errs || [])`) || '[]');
  check('无未捕获页面错误', errs.length === 0, errs.join(' | '));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n冒烟结果：${results.length - failed}/${results.length} 通过`);
try { await fetch(`${BASE}/json/close/${target.id}`); } catch { /* ignore */ }
ws.close();
process.exit(failed ? 1 : 0);
