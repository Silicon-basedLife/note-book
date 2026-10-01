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
    assert.match(
      pkg.scripts[`post${name}`] ?? '',
      /sign-exe\.ps1/,
      `post${name} 应调用 sign-exe.ps1`,
    );
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

test('界面取证：probe-ui 必须读取完整 WebSocket 消息（分帧会截断大响应）', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['probe:ui'] ?? '', /probe-ui\.ps1/, '应提供 npm run probe:ui');
  const src = read('scripts/probe-ui.ps1');
  assert.match(src, /debugging-port/, '必须说明如何开启 WebView2 远程调试');
  assert.match(src, /EndOfMessage/, '必须循环读到 EndOfMessage，否则截图这类大响应会被截断');
  assert.match(src, /Runtime\.enable/, '必须启用运行时事件才能抓到 JS 异常');
  assert.match(src, /exceptionThrown/, '必须报告未捕获异常');
  assert.match(src, /captureScreenshot/, '应支持截图取证');
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

test('文件格式不变量：工作树行尾必须符合 .gitattributes 约定（Windows 脚本 CRLF，其余 LF）', () => {
  // 2026-10-01 加上这条：编辑工具在 Windows 上会把文件写成 CRLF，于是 AGENTS.md、README.md、
  // docs/PROGRESS.md 等 6 个文档的工作树行尾悄悄变成了 CRLF，与 .gitattributes 的约定不符
  // （git 只在下次 checkout 时才纠正，本地测试与 diff 却一直带着噪音）。
  const WINDOWS_SCRIPT = new Set(['.ps1', '.bat', '.cmd']);
  const files = collectTextFiles().filter((file) => !file.endsWith('.tmp-'));
  assert.ok(files.length > 30, `扫描到的文件太少（${files.length}）`);

  const offenders = [];
  for (const file of files) {
    const rel = relative(root, file);
    const raw = readFileSync(file);
    const crlf = raw.filter((b) => b === 13).length;
    const lf = raw.filter((b) => b === 10).length;
    if (lf === 0) continue; // 单行文件无所谓
    if (WINDOWS_SCRIPT.has(extname(rel))) {
      if (crlf !== lf) offenders.push(`${rel}: Windows 脚本必须全部 CRLF（CR=${crlf} LF=${lf}）`);
    } else if (crlf > 0) {
      offenders.push(`${rel}: 应为 LF，但发现 ${crlf} 个 CR`);
    }
  }
  assert.deepEqual(offenders, [], `行尾不符合 .gitattributes 约定：\n${offenders.join('\n')}`);
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
    assert.ok(
      max < 128,
      `${p} 含非 ASCII 字节（最大 ${max}）：请保持纯 ASCII，或用带 BOM 的 UTF-8`,
    );
  }
});

// 必须保持 UTF-8 的仓库文本。
// 点文件与点目录要**显式列出**：早期实现是"跳过所有以 . 开头的项"，结果
// `.gitignore` / `.gitattributes` / `.github` 全都没被扫到；我用 PowerShell 的
// Add-Content（5.1 默认 ANSI）往 .gitignore 追加中文注释时写进了 GBK 字节，
// 守卫却一声不响 —— 2026-10-01 修掉（同时把没有理由的 `demo` 豁免也去掉）。
const TEXT_EXT = new Set([
  '.md',
  '.ts',
  '.svelte',
  '.css',
  '.mjs',
  '.js',
  '.json',
  '.html',
  '.ps1',
  '.bat',
  '.cmd',
  '.toml',
  '.yml',
  '.yaml',
]);
const TEXT_FILES = [
  '.gitignore',
  '.gitattributes',
  'README.md',
  '使用教程.md',
  'AGENTS.md',
  'package.json',
  'web/package.json',
  'web/index.html',
  'web/settings.html',
];
const TEXT_DIRS = ['docs', 'web/src', 'web/scripts', 'scripts', 'tests', '.github'];
// 只跳过明确不该扫描的目录；不要为了让守卫"少报错"而豁免真实代码目录。
const SKIP_DIR = new Set([
  'node_modules',
  'target',
  'dist',
  '.git',
  '.local-webview',
  '.signing',
  '.npm-cache',
  '.smoke-profile',
]);

function collectTextFiles() {
  const out = [];
  for (const name of TEXT_FILES) {
    const full = join(root, name);
    if (existsSync(full)) out.push(full);
  }
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIR.has(entry.name)) walk(full);
      } else if (TEXT_EXT.has(extname(entry.name)) && !entry.name.startsWith('.tmp-')) {
        out.push(full);
      }
    }
  };
  for (const dir of TEXT_DIRS) {
    const full = join(root, dir);
    if (existsSync(full)) walk(full);
  }
  return out;
}

test('编码不变量：仓库文本必须是合法 UTF-8（含点文件与点目录）', () => {
  const files = collectTextFiles();
  assert.ok(files.length > 30, `扫描到的文件太少（${files.length}），守卫可能失效`);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const bad = [];
  for (const file of files) {
    try {
      decoder.decode(readFileSync(file));
    } catch {
      bad.push(relative(root, file));
    }
  }
  assert.deepEqual(
    bad,
    [],
    `以下文件不是合法 UTF-8（写入时用了 ANSI/GBK 编码？）：\n${bad.join('\n')}`,
  );
});

// 2026-09-30 我本人把 docs/PROGRESS.md 写坏过一次：用 PowerShell 5.1 的
// Get-Content -Raw（默认按 ANSI 读）做替换，再用 Set-Content -Encoding utf8 写回，
// 中文全部变成 "杩涘害涓庝氦鎺" 这类乱码，且**不可逆**（实测 1057 处字节丢失，
// 逆变换只能恢复 99%）。这条守卫让同类破坏在提交前就被拦住。
test('编码不变量：仓库文本里不得出现 UTF-8 被当 ANSI 读所产生的乱码特征', () => {
  const MOJIBAKE = [
    '\uFFFD',
    '锛',
    '鐨',
    '涓',
    '浜',
    '璁',
    '杩',
    '鍜',
    '鍦',
    '鐢',
    '鏂',
    '鐐',
    '銆',
    '鈥',
    '鏄',
    '鎴',
  ];
  const files = collectTextFiles();
  assert.ok(files.length > 30, `扫描到的文件太少（${files.length}），守卫可能失效`);

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
  assert.deepEqual(
    hits,
    [],
    `发现 ${hits.length} 个文件疑似被 ANSI 误读损坏：\n${hits.join('\n')}`,
  );
});

test('编码不变量：核心文档仍含预期中文（防止"整体被替换成乱码/空文件"）', () => {
  const progress = read('docs/PROGRESS.md');
  for (const phrase of ['进度与交接', '一句话现状', '待你在本机确认', '关键文件速查']) {
    assert.ok(progress.includes(phrase), `docs/PROGRESS.md 缺少预期短语：${phrase}`);
  }
  const readme = read('README.md');
  assert.ok(readme.includes('NoteApp'), 'README.md 内容异常');
});

test('规范基础设施：.editorconfig 与 .gitattributes 的编码/行尾约定必须一致', () => {
  assert.ok(
    existsSync(join(root, '.editorconfig')),
    '应提供 .editorconfig（编辑器无关的基础约定）',
  );
  const ec = read('.editorconfig');
  assert.match(ec, /charset\s*=\s*utf-8/, '.editorconfig 必须声明 UTF-8');
  assert.match(ec, /end_of_line\s*=\s*lf/, '.editorconfig 默认应为 LF');
  assert.match(ec, /\[\*\.\{bat,cmd,ps1\}\]/, 'Windows 脚本要在 .editorconfig 里单独声明');
  assert.match(ec, /end_of_line\s*=\s*crlf/, 'Windows 脚本必须 CRLF');
  assert.match(ec, /trim_trailing_whitespace\s*=\s*false/, 'Markdown 不能删行尾空格（是换行语义）');

  const ga = read('.gitattributes');
  assert.match(ga, /\*\s+text=auto\s+eol=lf/, '.gitattributes 应默认 LF');
  for (const ext of ['ps1', 'bat', 'cmd']) {
    assert.match(
      ga,
      new RegExp(`\\*\\.${ext}\\s+text\\s+eol=crlf`),
      `.gitattributes 应把 .${ext} 设为 CRLF`,
    );
  }
});

test('规范基础设施：verify 入口与 CI 必须真正卡住测试/类型/格式/lint', () => {
  const pkg = JSON.parse(read('package.json'));
  const verify = pkg.scripts.verify ?? '';
  assert.ok(verify, '应提供 npm run verify 一键校验');
  for (const part of ['test', 'typecheck', 'format:check', 'fmt:rust:check', 'lint:rust']) {
    assert.ok(verify.includes(part), `verify 应包含 ${part}`);
  }
  assert.ok(pkg.scripts['fmt:rust:check'], '应提供 rustfmt 检查入口');
  assert.ok(pkg.scripts['lint:rust'], '应提供 clippy 入口');
  assert.match(
    pkg.scripts['format:check'] ?? '',
    /--check/,
    'format:check 必须用 --check 而不是写入',
  );

  // Prettier 只负责逻辑代码：样式与模板是刻意手写的紧凑写法，必须留在忽略清单里，
  // 否则有人会"顺手"把 app.css 展开 1600 行并给界面带来视觉风险。
  const ignore = read('.prettierignore');
  for (const pattern of ['*.css', '*.svelte', '*.md']) {
    assert.ok(ignore.includes(pattern), `.prettierignore 应排除 ${pattern}`);
  }

  const ci = read('.github/workflows/release.yml');
  assert.match(
    ci,
    /cargo fmt --manifest-path src-tauri\/Cargo\.toml --check/,
    'CI 必须校验 Rust 格式',
  );
  assert.match(ci, /cargo clippy .*-D warnings/, 'CI 必须把 clippy warning 当错误');
  assert.match(ci, /npm run format:check/, 'CI 必须校验前端格式');
  assert.match(ci, /node --test .*tests/, 'CI 必须跑单测');
  assert.match(ci, /typecheck/, 'CI 必须跑类型检查');
});

test('测试命名规范：文件名必须体现覆盖层（core.* = web/src，demo.* = 原型层）', () => {
  // 背景：改名之前 `markdown.test.mjs` / `store.test.mjs` 看名字像生产测试，
  // 实际测的是 demo/ 里的原型；这让人无法判断"改这里会不会影响生产代码"。
  // 详见 tests/README.md。旧原型层 demo/ 及其 4 个测试已于 2026-10-01 删除，
  // 但 demo. 分支保留：将来再引入参照实现层时必须带此前缀。
  const ARTIFACT_TESTS = new Map([
    ['theme.css.test.mjs', '产物级：读 web/src/main/app.css 与两个 HTML 入口做样式契约'],
    ['scripts.build-guard.test.mjs', '产物级：仓库与工具链不变量'],
  ]);

  const files = readdirSync(join(root, 'tests')).filter((name) => name.endsWith('.test.mjs'));
  assert.ok(files.length >= 15, `测试文件太少（${files.length}），守卫可能失效`);

  // 只认"真的去 import / 读取该路径"。
  // 第一版写成"文件里出现 demo/ 就算覆盖"，结果把注释里提到 demo/ 的两个文件也误报了
  // （core.markdown.test.mjs 的说明、以及守卫自身的目录清单）。
  const refsPath = (src, prefix) => {
    const quoted = `['"][^'"]*${prefix}`;
    return (
      new RegExp(`from\\s+${quoted}`).test(src) ||
      new RegExp(`(readFile|readFileSync|resolve|join)\\([^)]*${quoted}`).test(src)
    );
  };

  const offenders = [];
  for (const name of files) {
    const src = read(`tests/${name}`);
    if (refsPath(src, 'demo/') && !name.startsWith('demo.')) {
      offenders.push(`${name}: 覆盖 demo/ 原型，必须以 demo. 开头`);
      continue;
    }
    if (refsPath(src, 'web/src/') && !name.startsWith('core.') && !ARTIFACT_TESTS.has(name)) {
      offenders.push(`${name}: 涉及 web/src，必须以 core. 开头或登记为产物级测试`);
    }
  }
  assert.deepEqual(offenders, [], `测试命名未体现覆盖层：\n${offenders.join('\n')}`);

  assert.ok(existsSync(join(root, 'tests', 'README.md')), 'tests/README.md 必须说明分层约定');
});

test('版本一致性：六处版本号必须一致（避免发出错版本的 release）', () => {
  // 2026-10-01 发布 v0.2.0 时踩到：改了 package.json / tauri.conf.json / Cargo.toml，
  // 却忘了两个 lock 文件里**根节点**的 version，而 Cargo.lock 里还有 3 处 0.1.0 属于依赖
  // （jiff-core / vswhom / windows-threading）—— 那些**绝不能跟着改**。
  const version = JSON.parse(read('package.json')).version;
  assert.match(version, /^\d+\.\d+\.\d+$/, `package.json 版本格式异常：${version}`);

  for (const file of ['web/package.json', 'src-tauri/tauri.conf.json']) {
    assert.equal(JSON.parse(read(file)).version, version, `${file} 版本与 package.json 不一致`);
  }

  // Cargo.toml：只看顶层那行（多行字符串上不能靠 Select-String 的 ^ 锚点）
  const cargo = read('src-tauri/Cargo.toml').match(/^version\s*=\s*"([^"]+)"/m);
  assert.ok(cargo, 'Cargo.toml 里找不到顶层 version');
  assert.equal(cargo[1], version, `Cargo.toml 版本 ${cargo[1]} 与 package.json 不一致`);

  // 两个 lock 文件的**根节点**（第一个 name/version 对）
  for (const lock of ['package-lock.json', 'web/package-lock.json']) {
    const matched = read(lock).match(/"name":\s*"[^"]+",\r?\n\s*"version":\s*"([^"]+)"/);
    assert.ok(matched, `${lock} 里找不到根节点的 version`);
    assert.equal(matched[1], version, `${lock} 根版本 ${matched[1]} 与 package.json 不一致`);
  }

  // Cargo.lock：按包名定位 noteapp，绝不能全局替换（依赖里也有 0.1.0）
  const noteapp = read('src-tauri/Cargo.lock').match(/name = "noteapp"\r?\nversion = "([^"]+)"/);
  assert.ok(noteapp, 'Cargo.lock 里找不到 noteapp 条目');
  assert.equal(
    noteapp[1],
    version,
    `Cargo.lock 的 noteapp 版本 ${noteapp[1]} 与 package.json 不一致`,
  );
});
