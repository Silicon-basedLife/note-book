// scripts/ui-smoke.mjs —— 真实 Chrome（CDP）端到端冒烟
// 前置：已启动带 --remote-debugging-port=9222 的 Chrome（独立 user-data-dir）。
// 运行：node scripts/ui-smoke.mjs   （另见根 README「验证」一节）
// 覆盖 P0 验收要点：新建→书写→自动保存→重启(重载)内容仍在、搜索命中跳转、
// 待办勾选回写、文件夹新建/移动、删除确认、快捷键帮助、无控制台错误。
import WebSocket from 'ws';

const DEBUG = process.env.CDP_PORT || '9222';
const APP_URL = process.env.SMOKE_URL || 'http://localhost:5173/';
const BASE = `http://127.0.0.1:${DEBUG}`;

// 1) 新建标签页目标
const target = await (async () => {
  const resp = await fetch(`${BASE}/json/new?about:blank`, { method: 'PUT' });
  if (!resp.ok) throw new Error(`无法创建 CDP 目标 (${resp.status})，请先启动 --remote-debugging-port=${DEBUG} 的 Chrome`);
  return resp.json();
})();

// 2) 连接页面调试 socket
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
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
    throw new Error('页面执行异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  }
  return r.result.value;
}
async function waitEval(expression, timeoutMs = 15000, step = 250) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(expression)) return true;
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
    window.__setValue = (el, v) => {
      el.focus();
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    window.__ready = () => !!document.querySelector('.app-shell');
  `,
});

await send('Page.navigate', { url: APP_URL });
const booted = await waitEval('window.__ready()', 20000);
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
check('应用启动并渲染主界面', !!booted);

if (booted) {
  check('空库显示空态引导', await evaluate(`!!document.querySelector('.empty-editor') && document.body.textContent.includes('这里还没有笔记')`));

  // 1) 新建笔记
  await evaluate(`document.querySelector('.sidebar .btn-primary').click()`);
  check('新建笔记进入编辑态', await waitEval(`!!document.querySelector('.title-input') && !!document.querySelector('#editor')`));
  check('列表出现新笔记行', await waitEval(`document.querySelectorAll('.note-row').length === 1`));

  // 2) 书写标题与正文（含待办与代码块）→ 自动保存
  await evaluate(`window.__setValue(document.querySelector('.title-input'), '冒烟测试笔记')`);
  const body = '冒烟正文\n\n- [ ] 待办一\n- [ ] 待办二\n\n```js\nconst x = 1;\n```';
  await evaluate(`window.__setValue(document.querySelector('#editor'), ${JSON.stringify(body)})`);
  const saved = await waitEval(`document.querySelector('.save-status') && document.querySelector('.save-status').textContent.includes('已保存')`, 8000);
  check('去抖自动保存并显示已保存', !!saved);
  check('列表标题同步为输入标题', await waitEval(`[...document.querySelectorAll('.note-title')].some((n) => n.textContent === '冒烟测试笔记')`));
  check('预览渲染待办与代码高亮', await evaluate(`document.querySelectorAll('#preview input.task-check').length === 2 && !!document.querySelector('#preview pre.code')`));

  // 3) 预览勾选待办 → 源文回写
  await evaluate(`document.querySelectorAll('#preview input.task-check')[0].click()`);
  check('勾选待办后源文回写为 [x]', await waitEval(`document.querySelector('#editor').value.includes('- [x] 待办一')`));

  // 4) 重载 = 重启页面：数据应仍在（IndexedDB 持久化 + 启动扫描重建索引）
  await send('Page.reload', { ignoreCache: true });
  await waitEval('window.__ready()', 20000);
  check('重载后笔记仍在列表', await waitEval(`[...document.querySelectorAll('.note-title')].some((n) => n.textContent === '冒烟测试笔记')`));
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('.note-row')].find((r) => r.textContent.includes('冒烟测试笔记'));
    row.click();
  })()`);
  await waitEval(`document.querySelector('.title-input') && document.querySelector('.title-input').value === '冒烟测试笔记'`);
  check('重载后正文与勾选状态保留', await evaluate(`document.querySelector('#editor').value.includes('- [x] 待办一')`));

  // 5) 全文搜索：正文命中、高亮并跳转
  await evaluate(`window.__setValue(document.querySelector('.searchbox input'), '待办二')`);
  check('搜索命中正文并高亮', await waitEval(`!!document.querySelector('.note-snippet mark') && document.body.textContent.includes('正文命中')`));
  await evaluate(`document.querySelector('.note-row').click()`);
  check('点击搜索结果打开对应笔记', await waitEval(`document.querySelector('.title-input').value === '冒烟测试笔记'`));
  await evaluate(`window.__setValue(document.querySelector('.searchbox input'), '')`);

  // 6) 文件夹：新建并移动笔记
  await evaluate(`document.querySelector('.btn-icon').click()`);
  check('出现新建文件夹输入框', await waitEval(`!!document.querySelector('.prompt-input')`));
  await evaluate(`window.__setValue(document.querySelector('.prompt-input'), '工作')`);
  await evaluate(`document.querySelector('.modal-actions .btn-primary').click()`);
  check('文件夹「工作」出现在侧栏', await waitEval(`[...document.querySelectorAll('.folder-name')].some((n) => n.textContent === '工作')`));
  await evaluate(`(() => {
    const sel = document.querySelector('.folder-chip');
    sel.value = '工作';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  check('笔记移入「工作」', await waitEval(`document.querySelector('.folder-chip').value === '工作'`));

  // 7) 快捷键帮助（Shift+?）
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true }))`);
  check('Shift+? 打开帮助面板', await waitEval(`document.body.textContent.includes('快捷键帮助') && !!document.querySelector('.help-card')`));
  await evaluate(`[...document.querySelectorAll('.help-card .btn-primary')][0].click()`);

  // 8) 删除（确认后空态恢复）
  await evaluate(`document.querySelector('.ed-right .btn-danger').click()`);
  check('删除需二次确认', await waitEval(`!!document.querySelector('.modal-card') && document.body.textContent.includes('不可撤销')`));
  await evaluate(`[...document.querySelectorAll('.modal-card .btn-danger')][0].click()`);
  check('删除后回到空态', await waitEval(`!!document.querySelector('.empty-editor')`, 8000));

  const errs = await evaluate(`JSON.stringify(window.__errs || [])`);
  const list = JSON.parse(errs || '[]');
  check('无未捕获页面错误', list.length === 0, list.join(' | '));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n冒烟结果：${results.length - failed}/${results.length} 通过`);
try { await fetch(`${BASE}/json/close/${target.id}`); } catch { /* ignore */ }
ws.close();
process.exit(failed ? 1 : 0);
