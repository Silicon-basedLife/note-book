// scripts.build-guard —— 把几条"踩过坑才知道"的构建脚本不变量固化成断言。
//
// 为什么需要：2026-09-30 的排查里，有三类问题都是"脚本文件本身"造成的，而且都不报错、
// 只表现为"应用莫名其妙用不了"，浪费了大量时间：
//   1) launch-noteapp.bat 用 LF 换行 → cmd.exe 把 REM 注释当命令执行（一屏报错）；
//   2) diagnose-startup.ps1 用 UTF-8 无 BOM + 中文 → Windows PowerShell 5.1 按 ANSI 读，
//      乱码后语法崩坏（Unexpected token）；
//   3) kill-running-app.mjs 没有轮换 WebView2 profile → 强杀应用时 WebView2 正在用 profile，
//      把 profile 写坏，之后每次启动都卡在 Tauri 的 setup()（窗口建不出来）。
// 单测锁不住"运行时行为"，但能锁住这些文件级不变量与接线，防止被无意改回去。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const bytes = (p) => readFileSync(join(root, p));

test('构建钩子：所有 tauri 构建入口都先跑 scripts/kill-running-app.mjs', () => {
  const pkg = JSON.parse(read('package.json'));
  const scripts = pkg.scripts ?? {};
  // 直接构建（desktop:exe / desktop:build / desktop:dev）必须挂 pre 钩子：否则
  // 正在运行的 exe 会锁住 target\release\noteapp.exe，cargo 报 "拒绝访问 (os error 5)"。
  for (const name of ['desktop:exe', 'desktop:build', 'desktop:dev']) {
    const pre = scripts[`pre${name}`];
    assert.equal(typeof pre, 'string', `缺少 pre${name} 钩子`);
    assert.match(pre, /kill-running-app\.mjs/, `pre${name} 应调用 kill-running-app.mjs`);
  }
  // setup.ps1 自己也会杀进程，但走同一条路更保险
  assert.match(scripts['predesktop:setup'] ?? '', /kill-running-app\.mjs/);
});

test('构建钩子：强杀应用后清空 WebView2 profile，但必须保留 profile 目录本身', () => {
  const src = read('scripts/kill-running-app.mjs');
  assert.match(src, /EBWebView/, '必须处理 WebView2 数据目录');
  assert.match(src, /readdirSync\(profile\)/, '必须清空 profile 的内容');
  // 关键不变量（2026-09-30 的教训）：目录本身既不能删也不能改名。
  // 在"安全软件按路径拦截这个 exe 写入"的机器上，应用自己建不出该路径——
  // 一旦删掉或改名，应用就再也起不来（窗口闪一下就消失）。
  // 且 profile 可能是 junction：改名链接会让它失效。
  assert.doesNotMatch(src, /rmSync\(profile[),]/, '不得直接删除 profile 目录本身');
  assert.doesNotMatch(src, /renameSync\(/, '不得改名 profile（会让目录消失或 junction 失效）');
  assert.match(src, /identifier/, '应读取 tauri.conf.json 的 identifier 而不是硬编码');
  // 非 Windows 必须安全退出
  assert.match(src, /process\.platform !== 'win32'/);
});

test('构建钩子：诊断脚本存在且提供 npm 入口', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['diagnose:startup'] ?? '', /diagnose-startup\.ps1/);
  assert.ok(existsSync(join(root, 'scripts', 'diagnose-startup.ps1')));
});

test('构建钩子：构建后自动去除网络标记（否则双击会弹「无法验证发布者」）', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const name of ['desktop:exe', 'desktop:build', 'desktop:dev', 'desktop:setup']) {
    const post = pkg.scripts[`post${name}`];
    assert.equal(typeof post, 'string', `缺少 post${name} 钩子`);
    assert.match(post, /postbuild-unblock\.mjs/, `post${name} 应调用 postbuild-unblock.mjs`);
  }
  const src = read('scripts/postbuild-unblock.mjs');
  assert.match(src, /Zone\.Identifier/, '必须删除 Zone.Identifier 备用数据流');
  assert.match(src, /process\.platform !== 'win32'/, '非 Windows 应安全退出');
});

test('启动入口：提供桌面快捷方式脚本（绕开资源管理器弹框）', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['shortcut:desktop'] ?? '', /create-desktop-shortcut\.ps1/);
  const p = 'scripts/create-desktop-shortcut.ps1';
  assert.ok(existsSync(join(root, p)));
  const src = read(p);
  // 必须走 cmd /c start（CreateProcess），而不是把快捷方式直接指向 exe
  assert.match(src, /cmd\.exe/, '快捷方式应通过 cmd.exe 启动');
  assert.match(src, /\/c start ""/, '应使用 cmd /c start "" 形式');
  assert.ok(existsSync(join(root, 'launch-noteapp.bat')), '启动器应保留');
});

test('WebView2 目录重定向：脚本存在且拒绝删除真实 profile', () => {
  const p = 'scripts/link-webview-dir.ps1';
  assert.ok(existsSync(join(root, p)), '必须提供可重复创建 junction 的脚本');
  const src = read(p);
  assert.match(src, /mklink \/J/, '应使用目录 junction');
  assert.match(src, /ReparsePoint/, '创建后必须验证链接属性');
  // 安全不变量：不能默默删掉一个真实（非空）的 WebView2 profile
  assert.match(src, /Refusing to delete a real WebView2 profile/, '非空真实目录必须拒绝删除');
});

test('exe 签名：构建后自动签名，脚本必须自建证书、信任它并回读校验', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const name of ['desktop:exe', 'desktop:build', 'desktop:dev']) {
    assert.match(pkg.scripts[`post${name}`] ?? '', /sign-exe\.ps1/, `post${name} 应调用 sign-exe.ps1`);
  }
  assert.match(pkg.scripts['sign:exe'] ?? '', /sign-exe\.ps1/, '应提供手动签名入口');
  const src = read('scripts/sign-exe.ps1');
  assert.match(src, /New-SelfSignedCertificate/, '应能自建代码签名证书');
  assert.match(src, /CodeSigningCert/, '证书类型必须是代码签名证书');
  // 不装进受信任存储的话，自签名反而会显示"签名无效"，比不签名更糟
  assert.match(src, /Cert:\\CurrentUser\\Root/, '必须让本账户信任该证书');
  assert.match(src, /TrustedPublisher/, '应同时加入受信任的发布者');
  assert.match(src, /Set-AuthenticodeSignature/, '必须真的执行签名');
  assert.match(src, /Status -eq 'Valid'/, '必须回读并校验签名状态，不能只看命令有没有报错');
});

test('清理 360 残留：脚本必须提权、先备份，且绝不碰浏览器与用户数据', () => {
  const p = 'scripts/remove-360-leftovers.ps1';
  assert.ok(existsSync(join(root, p)));
  const src = read(p);
  assert.match(src, /BuiltInRole\]::Administrator/, '必须要求管理员权限');
  assert.match(src, /reg export/, '删除前必须备份服务注册表项');
  assert.match(src, /Copy-Item/, '删除前必须备份驱动文件');
  // 硬守卫：这两个路径属于浏览器与用户数据（D:\360MoveData 里是迁移后的桌面）
  assert.match(src, /'D:\\360se6'/, '必须把浏览器目录列为禁改路径');
  assert.match(src, /'D:\\360MoveData'/, '必须把用户数据目录列为禁改路径（桌面在其中）');
  assert.match(src, /ABORT\] Refusing to touch/, '命中禁改路径必须中止');
  assert.match(src, /sc\.exe stop/, '应先尝试停止驱动而不是硬删');
  assert.match(src, /start= disabled/, '停不下来时应降级为禁用并提示重启');
});

test('文件格式不变量：.bat 必须是 CRLF，否则 cmd.exe 会把注释当命令执行', () => {
  const raw = bytes('launch-noteapp.bat');
  const lf = raw.filter((b) => b === 10).length;
  const cr = raw.filter((b) => b === 13).length;
  assert.ok(lf > 0, '文件不应为空');
  assert.equal(cr, lf, `CRLF 必须成对：CR=${cr} LF=${lf}`);
  // 每个 LF 前面都必须紧跟 CR（不存在裸 LF）
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === 10) assert.equal(raw[i - 1], 13, `第 ${i} 字节是裸 LF`);
  }
});

test('文件格式不变量：.bat 必须纯 ASCII（cmd 代码页会把非 ASCII 变乱码）', () => {
  const raw = bytes('launch-noteapp.bat');
  const max = raw.reduce((m, b) => Math.max(m, b), 0);
  assert.ok(max < 128, `发现非 ASCII 字节（最大 ${max}）`);
});

test('文件格式不变量：.ps1 必须纯 ASCII（PowerShell 5.1 无 BOM 时按 ANSI 读取）', () => {
  // 扫全部脚本，而不是写死名单：新增脚本会自动被覆盖（已经两次踩到"注释里写中文"）。
  const all = readdirSync(join(root, 'scripts')).filter((name) => name.endsWith('.ps1'));
  assert.ok(all.length > 0, 'scripts/ 下应有 .ps1 脚本');
  for (const name of all) {
    const p = `scripts/${name}`;
    const raw = bytes(p);
    const max = raw.reduce((m, b) => Math.max(m, b), 0);
    assert.ok(max < 128, `${p} 含非 ASCII 字节（最大 ${max}）：请保持纯 ASCII，或用带 BOM 的 UTF-8`);
  }
});

// 2026-09-30 我本人把 docs/PROGRESS.md 写坏过一次：用 PowerShell 5.1 的
// Get-Content -Raw（默认按 ANSI 读）做替换，再用 Set-Content -Encoding utf8 写回，
// 中文全部变成 "杩涘害涓庝氦鎺" 这类乱码，且**不可逆**（实测 1057 处字节丢失，
// 逆变换只能恢复 99%）。这条守卫让同类破坏在提交前就被拦住。
test('编码不变量：仓库文本里不得出现 UTF-8 被当 ANSI 读所产生的乱码特征', () => {
  const MOJIBAKE = ['\uFFFD', '锛', '鐨', '涓', '浜', '璁', '杩', '鍜', '鍦', '鐢', '鏂', '鐐', '銆', '鈥', '鏄', '鎴'];
  const EXT = new Set(['.md', '.ts', '.svelte', '.css', '.mjs', '.js', '.json', '.html', '.ps1', '.bat', '.toml', '.yml', '.yaml']);
  const SKIP_DIR = new Set(['node_modules', 'target', 'dist', '.git', 'demo']);
  const SCAN = ['docs', 'web/src', 'web/scripts', 'scripts', 'tests'];

  const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIR.has(entry.name)) walk(full, out);
      } else if (EXT.has(extname(entry.name))) {
        out.push(full);
      }
    }
    return out;
  };

  const files = [
    ...['README.md', '使用教程.md', 'AGENTS.md'].map((f) => join(root, f)).filter(existsSync),
    ...SCAN.filter((d) => existsSync(join(root, d))).flatMap((d) => walk(join(root, d))),
  ];
  assert.ok(files.length > 20, `扫描到的文件太少（${files.length}），守卫可能失效`);

  const hits = [];
  const self = join('tests', 'scripts.build-guard.test.mjs'); // 本文件含乱码字面量，跳过自身
  for (const file of files) {
    const rel = relative(root, file);
    if (rel === self) continue;
    const text = readFileSync(file, 'utf8');
    for (const marker of MOJIBAKE) {
      if (text.includes(marker)) {
        hits.push(`${rel}: 含乱码特征 ${JSON.stringify(marker)}`);
        break;
      }
    }
  }
  assert.deepEqual(hits, [], `发现 ${hits.length} 个文件疑似被 ANSI 误读损坏：\n${hits.join('\n')}`);
});

test('编码不变量：核心文档仍含预期中文（防止"整体被替换成乱码/空文件"）', () => {
  const progress = read('docs/PROGRESS.md');
  for (const phrase of ['进度与交接', '一句话现状', '待你在本机确认', '关键文件速查']) {
    assert.ok(progress.includes(phrase), `docs/PROGRESS.md 缺少预期短语：${phrase}`);
  }
  const readme = read('README.md');
  assert.ok(readme.includes('NoteApp'), 'README.md 内容异常');
});
