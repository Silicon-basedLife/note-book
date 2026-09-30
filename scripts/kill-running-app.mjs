// scripts/kill-running-app.mjs
// ---------------------------------------------------------------------------
// 编译前先结束正在运行的 NoteApp。
//
// 为什么需要：Windows 上正在运行的 exe 会被锁定，cargo 无法覆盖
//   src-tauri/target/release/noteapp.exe
// 于是编译直接失败：
//   error: failed to remove file `...\noteapp.exe`
//   Caused by: 拒绝访问。 (os error 5)
// scripts/setup.ps1 里本来就有这一步，但直接用 `npm run desktop:exe` /
// `npm run desktop:build` 时会绕过它，所以这里用 npm 的 pre 钩子兜住所有入口。
//
// 交叉平台安全：非 Windows 直接成功退出（本仓库的桌面构建只针对 Windows）。
// 注意：这里刻意用 stdio: 'ignore'，不捕获 taskkill 的输出（命名管道在受限环境会被拒）。
// ---------------------------------------------------------------------------
import { execFileSync } from 'node:child_process';

if (process.platform !== 'win32') {
  process.exit(0);
}

// Windows 文件名不区分大小写，但 taskkill 的 /im 匹配更稳妥地两种都试一次。
for (const name of ['noteapp.exe', 'NoteApp.exe']) {
  try {
    execFileSync('taskkill', ['/f', '/im', name], { stdio: 'ignore' });
  } catch {
    // 没有该进程时 taskkill 返回非 0 —— 这正是常见情况，忽略。
  }
}

console.log('[prebuild] 已尝试结束正在运行的 NoteApp 实例（避免 exe 被占用导致编译失败）');
