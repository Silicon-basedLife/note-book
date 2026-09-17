// scripts/settings-smoke.mjs —— 设置窗口冒烟（Web 路径：localStorage 持久化与交互）
// 前置：静态托管 web/dist + 带 CDP 的 Chrome（见 README「验证」）。
import WebSocket from 'ws';

const DEBUG = process.env.CDP_PORT || '9222';
const BASE_URL = process.env.SMOKE_URL || 'http://127.0.0.1:5174/';
const SETTINGS_URL = new URL('settings.html', BASE_URL).toString();
const BASE = `http://127.0.0.1:${DEBUG}`;

const target = await (async () => {
  const resp = await fetch(`${BASE}/json/new?about:blank`, { method: 'PUT' });
  if (!resp.ok) throw new Error(`CDP 不可用 (${resp.status})`);
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
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) {
    console.log('      [eval-warn] ' + String(r.exceptionDetails.text).split('\n')[0]);
    return undefined;
  }
  return r.result.value;
}
async function waitEval(expression, timeoutMs = 10000, step = 200) {
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
    window.__setValue = (el, v) => { if (!el) return false; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; };
    window.__ready = () => !!document.querySelector('.settings-shell');
  `,
});

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

await send('Page.navigate', { url: SETTINGS_URL });
// 确定性前置：清空既有设置，保证从默认值开始断言
await waitEval(`!!document.body`, 8000);
await evaluate(`(() => { try { localStorage.clear(); } catch {} return true; })()`);
await send('Page.reload', { ignoreCache: true });
check('设置窗口渲染', await waitEval('window.__ready()', 20000));
check('六个分类都存在', await evaluate(`document.querySelectorAll('.settings-nav .nav-btn').length === 6`));

// 通用：切换启动布局 → 持久化
await evaluate(`[...document.querySelectorAll('.nav-btn')].find((b) => b.textContent.includes('通用')).click()`);
check('通用页出现启动布局下拉', await waitEval(`!!document.querySelector('.settings-body select')`));
await evaluate(`(() => { const sel = document.querySelector('.settings-body select'); sel.value = 'fig5'; sel.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
check('启动布局写入 localStorage', await waitEval(`(localStorage.getItem('noteapp.settings.v1') || '').includes('fig5')`));

// 编辑器：自动保存去抖
await evaluate(`[...document.querySelectorAll('.nav-btn')].find((b) => b.textContent.includes('编辑器')).click()`);
check('编辑器页出现数值输入', await waitEval(`!!document.querySelector('.settings-body input[type=number]')`));
await evaluate(`window.__setValue(document.querySelector('.settings-body input[type=number]'), '900')`);
check('自动保存去抖写入设置', await waitEval(`(localStorage.getItem('noteapp.settings.v1') || '').includes('900')`));

// 快捷键：改键 + 冲突提示
await evaluate(`[...document.querySelectorAll('.nav-btn')].find((b) => b.textContent.includes('快捷键')).click()`);
check('快捷键列表渲染', await waitEval(`document.querySelectorAll('.keycap').length >= 4`));
check('默认键位展示（Ctrl + K）', await evaluate(`[...document.querySelectorAll('.keycap')].some((b) => b.textContent.includes('Ctrl + K'))`));
// 给“立即保存”换成 Ctrl+Shift+S（捕获存在竞态，失败重试一次）
async function setKeyFor(rowText, init) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await evaluate(`(() => { const rows = [...document.querySelectorAll('.row')]; const row = rows.find((r) => r.textContent.includes(${JSON.stringify(rowText)})); if (!row) return false; row.querySelector('.keycap').click(); return true; })()`);
    if (!(await waitEval(`!!document.querySelector('.keycap.capturing')`, 3000))) continue;
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify(init)}))`);
    if (await waitEval(`[...document.querySelectorAll('.keycap')].some((b) => b.textContent.includes(${JSON.stringify(init.expect)}))`, 4000)) return true;
    console.log('      [diag] keys=', await evaluate(`JSON.stringify([...document.querySelectorAll('.keycap')].map((b) => b.textContent.trim()))`),
      'err=', await evaluate(`document.querySelector('.err')?.textContent || ''`));
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
check('进入捕获状态', await evaluate(`(() => { const rows = [...document.querySelectorAll('.row')]; const row = rows.find((r) => r.textContent.includes('立即保存')); if (!row) return false; row.querySelector('.keycap').click(); return true; })()`) && await waitEval(`!!document.querySelector('.keycap.capturing')`));
check('键位更新为 Ctrl + Shift + S', await setKeyFor('立即保存', { key: 'S', ctrlKey: true, shiftKey: true, bubbles: true, expect: 'Ctrl + Shift + S' }));
// 再改成与“聚焦搜索”冲突的 Ctrl+K → 应提示冲突
await evaluate(`(() => { const rows = [...document.querySelectorAll('.row')]; const row = rows.find((r) => r.textContent.includes('立即保存')); row.querySelector('.keycap').click(); return true; })()`);
await waitEval(`!!document.querySelector('.keycap.capturing')`, 4000);
await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`);
check('冲突提示出现', await waitEval(`!!document.querySelector('.err') && document.body.textContent.includes('冲突')`));

// 存储页（Web 预览应提示仅桌面可用）
await evaluate(`[...document.querySelectorAll('.nav-btn')].find((b) => b.textContent.includes('存储')).click()`);
check('存储页提示仅桌面可用', await waitEval(`document.body.textContent.includes('存储位置管理仅在桌面版可用')`));

// 关于页
await evaluate(`[...document.querySelectorAll('.nav-btn')].find((b) => b.textContent.includes('关于')).click()`);
check('关于页显示版本', await waitEval(`document.body.textContent.includes('版本')`));

const errs = JSON.parse(await evaluate(`JSON.stringify(window.__errs || [])`) || '[]');
check('无未捕获错误', errs.length === 0, errs.join(' | '));

const failed = results.filter((r) => !r.ok).length;
console.log(`\n设置冒烟结果：${results.length - failed}/${results.length} 通过`);
try { await fetch(`${BASE}/json/close/${target.id}`); } catch { /* ignore */ }
ws.close();
process.exit(failed ? 1 : 0);
