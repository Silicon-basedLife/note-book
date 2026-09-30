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
// 确定性前置：把 prefers-color-scheme 固定成浅色（headless Chrome 默认值不保证），
// 否则 CI/本机上“跟随系统”的断言会随系统主题漂移；同时暴露 __setSystemTheme 用于
// 验证「跟随系统」是实时跟随的（主题监听会在变化时立刻重算）。
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    (() => {
      let systemDark = false;
      const listeners = new Set();
      const orig = window.matchMedia ? window.matchMedia.bind(window) : null;
      const stub = {
        media: '(prefers-color-scheme: dark)',
        get matches() { return systemDark; },
        addEventListener: (t, cb) => { if (t === 'change') listeners.add(cb); },
        removeEventListener: (t, cb) => { if (t === 'change') listeners.delete(cb); },
        addListener: (cb) => listeners.add(cb),
        removeListener: (cb) => listeners.delete(cb),
        onchange: null,
        dispatchEvent: () => true,
      };
      window.__listenerCount = () => listeners.size;
      window.__setSystemTheme = (dark) => {
        systemDark = dark === true;
        for (const cb of [...listeners]) {
          try { cb({ matches: systemDark, media: stub.media }); } catch {}
        }
        return true;
      };
      window.matchMedia = (q) =>
        /prefers-color-scheme/.test(String(q)) ? stub : (orig ? orig(q) : stub);
      window.__errs = [];
      window.addEventListener('error', (e) => window.__errs.push('err: ' + (e.message || String(e))));
      window.addEventListener('unhandledrejection', (e) => window.__errs.push('rej: ' + String(e.reason)));
      window.__setValue = (el, v) => { if (!el) return false; el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true; };
      window.__ready = () => !!document.querySelector('.settings-shell');
    })();
  `,
});

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

/**
 * 等待“设置已写盘”的确定性条件：解析 JSON 后按键路径取值再比较。
 * 不要用 `raw.includes('"dark"')` 这种原始字符串匹配——它会被字段顺序/转义/写入时机影响，
 * 实测偶发失败（写盘是 300ms 去抖，字符串匹配又只看某一瞬间）。
 */
function settingsEq(path, value) {
  const keys = JSON.stringify(path.split('.'));
  return `(() => { try {
    const raw = localStorage.getItem('noteapp.settings.v1');
    if (!raw) return false;
    let cur = JSON.parse(raw);
    for (const k of ${keys}) cur = cur == null ? undefined : cur[k];
    return cur === ${JSON.stringify(value)};
  } catch { return false; } })()`;
}

await send('Page.navigate', { url: SETTINGS_URL });
// 确定性前置：清空既有设置，保证从默认值开始断言
await waitEval(`!!document.body`, 8000);
await evaluate(`(() => { try { localStorage.clear(); } catch {} return true; })()`);
await send('Page.reload', { ignoreCache: true });
check('设置窗口渲染', await waitEval('window.__ready()', 20000));
check('六个分类都存在', await evaluate(`document.querySelectorAll('.settings-nav .nav-btn').length === 6`));

// 通用：切换启动布局 → 持久化
// 注意：按 id 定位，不要用 `.settings-body select` 的第一个——通用页第一行现在是主题
// （三个按钮），“第一行就是启动布局下拉”的假设已不成立。
await evaluate(`[...document.querySelectorAll('.nav-btn')].find((b) => b.textContent.includes('通用')).click()`);
check('通用页出现启动布局下拉', await waitEval(`!!document.querySelector('#start-layout')`));
await evaluate(`window.__setValue(document.querySelector('#start-layout'), 'fig5')`);
check('启动布局写入 localStorage', await waitEval(settingsEq('general.startLayout', 'fig5'), 15000));

// 通用：主题（浅 / 深 / 跟随系统）→ 立即应用 + 持久化
await evaluate(`window.__bg = () => getComputedStyle(document.body).backgroundColor`);
await evaluate(`(() => { const b = document.querySelector('[data-theme-choice="dark"]'); if (!b) return false; b.click(); return true; })()`);
check('选择深色后 html[data-theme=dark]', await waitEval(`document.documentElement.dataset.theme === 'dark'`));
check('深色立即生效（页面底色变暗）', await waitEval(`(() => { const m = window.__bg().match(/\\d+/g); return !!m && Number(m[0]) < 120; })()`));
check('深色选择写入 localStorage', await waitEval(settingsEq('general.theme', 'dark'), 15000));
await evaluate(`(() => { const b = document.querySelector('[data-theme-choice="system"]'); if (!b) return false; b.click(); return true; })()`);
check('跟随系统：data-theme 与系统偏好一致', await waitEval(`document.documentElement.dataset.theme === (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')`));
check('跟随系统写入 localStorage', await waitEval(settingsEq('general.theme', 'system'), 15000));
await evaluate(`(() => { const b = document.querySelector('[data-theme-choice="light"]'); if (!b) return false; b.click(); return true; })()`);
check('切回浅色立即生效', await waitEval(`document.documentElement.dataset.theme === 'light'`));
check('非「跟随系统」档位不挂系统主题监听', await evaluate(`window.__listenerCount() === 0`));

// 通用：主题「跟随系统」是实时跟随的（系统主题变化 → 立即重算，无需重开窗口）
await evaluate(`(() => { const b = document.querySelector('[data-theme-choice="system"]'); if (!b) return false; b.click(); return true; })()`);
check('「跟随系统」已挂上监听', await waitEval(`window.__listenerCount() >= 1`));
await evaluate(`window.__setSystemTheme(true)`);
check('系统转深色时立即跟随（无需重开窗口）', await waitEval(`document.documentElement.dataset.theme === 'dark'`));
await evaluate(`window.__setSystemTheme(false)`);
check('系统转回浅色时立即跟随', await waitEval(`document.documentElement.dataset.theme === 'light'`));
await evaluate(`(() => { const b = document.querySelector('[data-theme-choice="light"]'); if (!b) return false; b.click(); return true; })()`);
check('切到固定浅色后释放系统主题监听', await waitEval(`window.__listenerCount() === 0`));

// 编辑器：自动保存去抖
await evaluate(`[...document.querySelectorAll('.nav-btn')].find((b) => b.textContent.includes('编辑器')).click()`);
check('编辑器页出现数值输入', await waitEval(`!!document.querySelector('.settings-body input[type=number]')`));
await evaluate(`window.__setValue(document.querySelector('.settings-body input[type=number]'), '900')`);
check('自动保存去抖写入设置', await waitEval(settingsEq('editor.autoSaveMs', 900), 15000));

// 编辑器：回车即换行（默认开启，可关闭）
check('编辑器页出现「回车即换行」开关', await waitEval(`!!document.querySelector('#hard-breaks')`));
check('「回车即换行」默认为开启', await evaluate(`document.querySelector('#hard-breaks').checked === true`));
await evaluate(`document.querySelector('#hard-breaks').click()`);
check('关闭后写入设置（hardBreaks:false）', await waitEval(`(() => { const raw = localStorage.getItem('noteapp.settings.v1'); if (!raw) return false; return JSON.parse(raw).editor.hardBreaks === false; })()`, 4000));
await evaluate(`document.querySelector('#hard-breaks').click()`);
check('再次打开恢复 hardBreaks:true', await waitEval(`(() => { const raw = localStorage.getItem('noteapp.settings.v1'); if (!raw) return false; return JSON.parse(raw).editor.hardBreaks === true; })()`, 4000));

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
