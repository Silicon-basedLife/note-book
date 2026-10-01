# NoteApp 交接文档（v0.2.0 之后）

> **用途**：换新对话时**先读这一份**，它自包含。更详细的历史与踩坑记录在
> [`PROGRESS.md`](PROGRESS.md)（§1.1–§1.16 逐功能记录、§3.3 教训清单）。
> 本文件写于 **2026-10-01**，对应 **已发布的 v0.2.0**。

---

## 0. 一句话现状

**NoteApp 桌面版可用且已发布 v0.2.0**（Windows，纯本地 Markdown）。
P0 MVP 与 ROADMAP 里大部分"基础增强"都已完成；**剩下的主要是 P1 的"效率增强"：悬浮速记窗 / 全局热键 / 托盘常驻 / 附件 / 多级目录等**。

| 项目 | 值 |
| --- | --- |
| 仓库 | `E:\AI学习\note-app`（远端 `https://github.com/Silicon-basedLife/note-book.git`，分支 `master`） |
| 当前提交 | **`b6a6512`**（`master` 与远端一致，工作树干净） |
| 标签 / 发布 | `v0.1.0`、**`v0.2.0`（已发布，含 NSIS + MSI 两个安装包）** |
| 发布页 | https://github.com/Silicon-basedLife/note-book/releases/tag/v0.2.0 |
| 单测 | **184 项全绿**（`npm test`） |
| 门禁 | **`npm run verify` 退出码 0**（单测 + tsc + Prettier + rustfmt + clippy） |
| 技术栈 | Tauri 2.11 + Svelte 5（runes）+ TypeScript + Vite；Rust 薄壳只做文件读写 |

---

## 1. 已完成（可以认为是"稳定"的部分）

### 1.1 P0 基础能力
- **纯本地 Markdown**：一条笔记 = 一个 `.md` 文件，frontmatter 承载标题/文件夹/时间/回收站标记/`tags`/`pinned`；`meta.json` 存文件夹与排序。
- **三栏 + 面板级联**：默认仅侧栏 → 点文件夹滑出笔记列 → 点笔记滑出编辑区；窗口宽度随面板开合自动缩放。
- **编辑体验**：实时预览（markdown-it + GFM + `==高亮==`）、代码高亮、编辑/分屏/预览三视图、`Ctrl+S`、自动保存去抖（默认 600ms 可调）、全文搜索（`Ctrl+K`）、文件夹、回收站（软删除/还原/彻底删除/清空）、多选批量、拖拽排序、待办勾选回写。

### 1.2 v0.1.0 之后新增（v0.2.0 才真正包含）
> 注意：**`v0.1.0` 的发布说明写在了代码之前、后来又被多个功能提交继续编辑**，所以它列了当时并不存在的功能。以代码为准（`git cat-file -e v0.1.0:<path>` 核实）：

- **主题**：浅色 / 深色 / 跟随系统（实时跟随系统主题、双窗口同步、首屏防闪烁、全量 CSS 变量化）
- **标签与置顶**：编辑区回车加标签、按标签筛选、置顶固定（写进 `.md` frontmatter）
- **待办聚合视图**：全库未完成 `- [ ]` 汇总、勾选回写源文、点任务跳回定位
- **Markdown 格式工具栏**：加粗/斜体/删除线/高亮、标题、列表、引用、代码块、链接、表格、撤销重做
- **《使用教程》**（`使用教程.md`）+ 可导入的示例笔记（`docs/import/`）
- **布局修复**：仅预览/仅编辑占满、放大不留白、分屏比例可拖可存（双击恢复各半）
- **独立设置窗口**（`Ctrl + ,`）：通用/快捷键/存储/编辑器/窗口与吸附/关于；**存储位置迁移**（原生选目录、复制后切指针、原目录保留）

### 1.3 可靠性与工程（v0.2.0 的另一条主线）
- 启动器 `launch-noteapp.bat` + 桌面快捷方式（`npm run shortcut:desktop`，绕开"无法验证发布者"）
- **自签名代码签名证书**（`npm run sign:exe`，已接入构建后步骤；弹窗显示 `NoteApp Local Build`）
- 构建前自动结束应用 + **清空 WebView2 profile 内容**（修掉"编译一次就把应用搞坏"）
- 构建后去除网络标记（`postbuild-unblock.mjs`）
- **启动日志与 panic 记录**（`noteapp-log.txt`，release 是 GUI 子系统，此前 panic 不可见）
- 诊断工具：`npm run diagnose:startup`、`npm run probe:ui`（窗口空白取证）、`npm run link:webview`、`npm run clean:360`
- **规范门禁**：`npm run verify` + CI 五步（Prettier 仅 `.ts`/`.mjs`、rustfmt、clippy、tsc、单测）
- 删除了 P0 时期的浏览器原型 `demo/`（含 4 个专属测试），仓库只保留一条生产实现线
- CI 失败可诊断：`scripts/ci-check.ps1` 把失败输出写进 job summary 并抛 `::error::` 注解（公开 API 可读）

---

## 2. 未完成（下一步的工作面）

### 2.1 P1 功能（ROADMAP 明确列出，**都没做**）
| 功能 | 现状 / 起点 |
| --- | --- |
| **悬浮速记 / 快搜窗（P1 重点）** | 需要第二窗口 + 托盘；设置窗口已经是"多窗口"的现成样板 |
| **系统级全局热键** | 动作注册表（`web/src/lib/core/actions.ts`）已就绪，只需接 Tauri `global-shortcut` 插件 |
| **托盘常驻 / 关窗不退** | 悬浮窗依赖它（"关窗后仍能响应全局热键"） |
| 附件：粘贴 / 拖拽图片入库 | 需先定附件目录规则（存储页已留位） |
| 多级目录 | 目前只有一级文件夹 |
| 笔记历史版本 | — |
| 回收站自动清理策略（永久 / 30 天） | 存储页已留位 |
| 导出 HTML / PDF | PDF 需评估 Tauri 打印能力 |
| 命令面板（`Ctrl+K` 目前只用于搜索聚焦） | 可扩展成真正的命令面板 |
| 字数统计扩展（词/行） | 目前只有字符数 |
| 设置项搜索、快捷键方案导入导出 | — |
| **真·OS 级屏幕边缘自动隐藏** | 现为"窗口内收边 + 越界吸附缩进"，与系统贴靠共存 |

### 2.2 低风险增强（曾提议、用户未选择）
- 迁移前自动 zip 备份（保留最近 N 份）
- `storage.json` 指向目录不存在时**弹提示**（重选 / 回退默认），避免"静默回落看起来像丢笔记"
- "直接指向已有笔记目录（不复制）"：换电脑接上已有目录

### 2.3 已知问题（都不阻塞使用）
1. **5 条 Svelte a11y 编译警告**：`web/src/main/App.svelte` 里 `<div>`/`<span>` 绑 click/contextmenu 但缺 ARIA role 与键盘处理。修它要动交互结构（role/tabindex/键盘路径），是独立任务。
2. **仅本机（与代码无关）**：某安全软件的**残留过滤驱动**会按路径拦截本应用写 `%LOCALAPPDATA%\com.noteapp.desktop`。现在靠**目录链接**绕开：
   `%LOCALAPPDATA%\com.noteapp.desktop\EBWebView` → `E:\AI学习\note-app\.local-webview`
   **删掉这个链接，应用就会回到"窗口闪一下就消失"**。想根治可查 Windows Defender 的**受控文件夹访问**（`Get-MpPreference` 需要管理员，尚未排查）。
3. `360Box64.sys` 驱动文件仍在磁盘（已 `Start=4` 禁用 + Stopped）。**重启后**跑一次 `npm run clean:360`（管理员）彻底删除；备份在 `C:\ProgramData\noteapp-360-backup-*`。
4. 本开发沙箱**没有 cargo**（crates.io 不可达），Rust 侧改动必须让用户在本机构建验证。

---

## 3. 给下一个对话的指示（可直接整段粘贴）

> 我在继续维护 **NoteApp**（`E:\AI学习\note-app`，Tauri 2 + Svelte 5 + TypeScript，纯本地 Markdown 笔记本，Windows 桌面端）。
>
> **请先按顺序读这四个文件，再动手**：
> 1. `docs/HANDOFF_v0.2.0.md`（交接文档，本文件）
> 2. `AGENTS.md`（约定：每次改动必须 Git commit；必须先写/更新测试并让全部验证通过再交付）
> 3. `docs/PROGRESS.md`（逐功能记录 §1.x、**§3.3 教训清单务必读**）
> 4. `docs/ROADMAP.md`（P1 范围）
>
> **当前状态**：HEAD `b6a6512`，v0.2.0 已发布（GitHub Release 有两个安装包），184 项单测全绿，`npm run verify` 退出码 0，工作树干净。
>
> **先做这一步（不要跳过）**：跑 `npm run verify`，确认基线是绿的；再看 `git log --oneline -5` 与 `git status`。
>
> **我想做的是**：〔在这里写你要的功能，例如"做 P1 的悬浮速记窗"〕
>
> **几条硬约束（踩过坑，务必遵守）**：
> - **提交信息一律写进文件后用 `git commit -F`**：`-m` 里带中文引号/`$()`/反引号会被 PowerShell 拆坏（本项目已失败 4 次）。
> - **改 UTF-8 文件不要用 `Get-Content`/`Set-Content`/`Add-Content`**（PS 5.1 默认 ANSI，会把中文变成不可逆乱码）。用编辑工具，或显式 `[System.IO.File]::ReadAllText/WriteAllText` + UTF-8。
> - **`scripts/*.ps1` 必须纯 ASCII + CRLF**；`*.bat`/`*.cmd` 必须 CRLF（有守卫测试）。
> - **绝对不要在 WebView2 正在使用 profile 时强杀应用**；强杀后必须**清空 profile 内容**，且**不能删/改名 `EBWebView` 目录本身**（它可能是目录链接，且本机应用建不出该路径）。
> - **排序/断言不要用 `localeCompare`**：它随系统区域设置变化，会让本地与 CI 结果相反（本项目因此浪费过一整轮发布）。
> - `vite build`、`npm ci`、`cargo` 在这个沙箱里需要 `sandbox_permissions: danger-full-access`（否则 spawn EPERM）。
> - **交付前必须跑 `npm run verify` 并全绿**，然后 commit 并 push（`git push origin master`）。
>
> **发布新版本的方式**（如果这次要发版）：改 6 处版本号（`package.json`、`web/package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、两个 lock 文件的**根节点**、`Cargo.lock` 里 **noteapp 那一条**——注意 `Cargo.lock` 里还有依赖的 `0.1.0`，别全局替换）→ 写 `docs/RELEASE_NOTES_vX.Y.Z.md` → `git tag -a vX.Y.Z` → `git push origin vX.Y.Z`，CI 会自动构建并创建 Release（约 9 分钟）。**注意 GitHub 只在失败时发邮件，成功不发**，别因为没收到邮件以为没发出去。

---

## 4. 常用命令速查

```powershell
npm test                    # 184 项单测
npm run verify              # 提交前必跑：单测 + tsc + Prettier + rustfmt + clippy
npm run build               # 前端产物到 web/dist
npm run desktop:exe         # 编译桌面 exe（需本机有 Rust）
npm run shortcut:desktop    # 桌面创建 NoteApp 图标
npm run sign:exe            # 自签名证书 + 签名（幂等）
npm run probe:ui            # 窗口空白取证（可 -Out shot.png 截图）
npm run diagnose:startup    # 启动诊断（含 WebView2 崩溃查询）
npm run link:webview        # 重建 profile 目录重定向（本机必需）
npm run clean:360           # 清理 360 残留驱动（管理员）
```

## 5. 目录速查

```
web/src/lib/core/      纯逻辑核心（store/search/markdown/todos/tags…，单测覆盖）
web/src/lib/settings/  设置模型与归一化（主窗口与设置窗口共用）
web/src/lib/desktop/   side-dock（QQ 吸附）+ dock-core（纯计算，单测覆盖）
web/src/main/          主窗口（App.svelte / app.css）
web/src/settings/      独立设置窗口
src-tauri/src/         Rust 薄壳：fs_store.rs（全部命令）、lib.rs（注册 + 启动日志/panic 钩子）
tests/                 node:test；分层约定见 tests/README.md
scripts/               构建/诊断/修复脚本（见 PROGRESS §1.16）
docs/                  PROGRESS / ROADMAP / TECH_DESIGN / RELEASE_NOTES / 本文件
```
