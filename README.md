# NoteApp —— 本地 Markdown 笔记应用

依据 [docs/ROADMAP.md](docs/ROADMAP.md)（产品路线图）与 [docs/TECH_DESIGN.md](docs/TECH_DESIGN.md)（技术方案）实现。

- 定位：**Windows 桌面软件（Tauri 2 + Svelte + TypeScript）**，纯本地存储，每条笔记一个 `.md` 文件。
- 当前里程碑：P0 MVP 全部功能 + P1 架构预留（见下文「范围与预留」）。
- 质量约定：遵循 [AGENTS.md](AGENTS.md) —— 每次改动一个 Git commit；功能落地同步测试且全绿后交付。
- **进度与交接**：见 [docs/PROGRESS.md](docs/PROGRESS.md)（已完成 / 待确认 / 未完成 / 下一步指示 / 环境命令速查）。

## 桌面版（Windows，Tauri 2）

仓库已包含完整桌面工程（`src-tauri/` Rust 薄壳 + 现有 Svelte UI），在本机**有网络的普通终端**执行一次即可产出可运行/可安装的程序：

```powershell
npm run desktop:setup     # = scripts/setup.ps1：装 Rust(如缺) → 装依赖 → 构建 NoteApp.exe
```

产物位置（默认构建免安装 exe；MSI/NSIS 安装包需 github.com 可达时执行 `npm run desktop:build`）：

- 免安装直接运行：`src-tauri\target\release\NoteApp.exe`
- 安装包（可选）：`src-tauri\target\release\bundle\msi\NoteApp_0.1.0_x64_en-US.msi`
  `src-tauri\target\release\bundle\nsis\NoteApp_0.1.0_x64-setup.exe`

数据存放：`%APPDATA%\com.noteapp.desktop\notes\<id>.md`（笔记）+ 同目录 `meta.json`（文件夹等元数据），纯文本可随时备份。

> 说明：本仓库的开发沙箱网络只放行 npm 源，`cargo` 需要的 crates.io / static.rust-lang.org 不可达，
> 因此 **cargo/tauri 的最终编译需在你的本机终端执行**（`npm run desktop:setup`）。代码侧验证（206 项单测、
> tsc、vite build、真实 Chrome 冒烟、`npm run verify` 规范门禁）均已在此环境通过；Rust 薄壳只做 8 个文件读写命令（薄壳核心边界，
> 见 [TECH_DESIGN §1.1/§2](docs/TECH_DESIGN.md)），前端存储适配器见 `web/src/lib/core/storage/tauri.ts`。
>
> 另外：**打包 MSI/NSIS 安装包**需要 Tauri 从 github.com 下载 NSIS/WiX 工具；若网络访问不了
> github.com，默认流程只产出可运行的 `NoteApp.exe`（`tauri build --no-bundle`），
> 安装包留到可访问 github.com 的网络下执行 `npm run desktop:build` 即可。

桌面版日常开发：`npm run desktop:dev`（Vite + WebView 热更）。

## Web 开发版（同一套代码）

`npm run dev` 可在浏览器开发/验证同一 UI；此时数据层回退到 IndexedDB 虚拟文件系统（仅便于开发，
桌面版始终写真实 `.md` 文件）。


## 功能（P0 MVP）

| 能力 | 说明 |
|---|---|
| 三栏布局 | 文件夹列表 → 笔记列表 → 编辑 / 实时预览 |
| 新建 / 删除 / 重命名 | 删除二次确认；标题即重命名 |
| Markdown 编辑 + 实时预览 | markdown-it + GFM（表格/删除线/链接化）+ `==高亮==` + highlight.js 高亮；编辑/分屏/预览三种视图 |
| 格式工具栏 | 编辑区分组按钮（加粗/斜体/删除线/高亮 · H1-H3 · 列表/待办/引用/代码块 · 链接/表格 · 撤销/重做，`⋯` 里还有行内代码与分隔线）：选中文字点按钮即套语法、再点取消，**不必记 Markdown 符号** |
| 自动保存 | 输入去抖（600ms）落盘，界面显示 未保存 / 保存中 / 已保存 |
| 全文搜索 | 标题 + 正文，即时结果、命中片段高亮、点击跳转（`Ctrl+K` 聚焦） |
| 文件夹（一级目录） | 新建 / 双击重命名 / 删除（笔记自动移入收件箱）；笔记可移动到其它文件夹 |
| 代码块语法高亮 | js/ts/python/bash/rust/go/java/c/cpp/css/sql/json/markdown/xml/yaml |
| 待办勾选 | `- [ ] task` 在预览中可勾选，源文即时回写 |
| 纯本地存储 | 一条笔记一个 `.md` 文件 + frontmatter；Web 端以 IndexedDB 虚拟文件系统持久化 |
| 主题 | 浅色 / 深色 / 跟随系统；主窗口与设置窗口同时生效、跨窗口同步、重启保持，首屏无白屏闪烁 |
| 标签 | 编辑区回车添加（空格/逗号可分隔多个）、点标签条按标签筛选、笔记行显示标签摘要；写在 frontmatter 的 `tags` 里 |
| 笔记置顶 | 编辑区「📌 置顶」/ 行右键 / 多选批量；置顶笔记固定排在列表最前（与手排、时间序并存） |
| 待办聚合 | 左栏「☑️ 待办」汇总全库未完成 `- [ ]`；勾选即回写源文、点任务文本跳回原笔记并定位该行、可切换显示已完成 |
| 快捷键 | `Ctrl+K` 搜索、`Alt+N` 新建、`Ctrl+S` 立即保存、`Ctrl+B`/`Ctrl+I` 加粗斜体、`Ctrl+Z`/`Ctrl+Y` 撤销重做、`Shift+?` 帮助、`Esc` 关闭弹层 |
| 安全 | 用户 HTML 全部转义 + 渲染输出白名单清洗；`javascript:` 链接不可点击 |

### 增强交互模块（已落地）

- **右键菜单**：文件夹（其中新建笔记 / 新建文件夹 / 重命名 / 删除进回收站）、列表空白处（新建）、笔记行（移入回收站 / 还原 / 彻底删除）、回收站文件夹（还原 / 彻底删除）
- **回收站**：删除=软删除保留结构，可单条/整组还原，支持彻底删除与清空；回收站条目只读（横幅提示还原）；全部视图搜索包含回收站命中（🗑️标记可跳转）
- **多选批量**：「选择」模式 / Ctrl、Shift、全选，批量移入回收站 / 还原 / 彻底删除（带确认）
- **拖拽**：文件夹拖拽排序（插入指示线、持久化）；笔记拖到文件夹即移动、拖到回收站即删除；列表内拖拽手动排序（可一键“恢复时间序”）
- **文件夹**：▶/▼ 展开箭头与手风琴（再点收回）、悬停时笔记数变 ✕ 快捷删除、双击/右键重命名
- **面板级联**：默认仅侧栏（图3）且**桌面窗口收缩到侧栏宽度**（无右侧空白）；点文件夹滑出笔记列（图4，窗口加宽），点笔记滑出编辑区（图5）；再点同类或边缘手柄逐级收回，窗口随开合自动缩放（Tauri `setSize`；Web 预览仅内容自适应，不缩放浏览器窗口）。**窗口比内容宽时由编辑区吸收多余空间（放大/最大化后不再留白）**；若窗口已经比你需要的更宽，点开面板不会把窗口缩回去
- **编辑/预览宽度可调**：分屏时中间有一条分隔条，**拖动即可改变两边比例**（双击恢复各半），比例写进 `settings.json`（`editor.splitRatio`，范围 20%–80%）并重启保持；只显示编辑或只显示预览时，内容自动占满整个编辑区（不再被压成半宽）
- **侧边吸附（桌面，QQ 式）**：图3 态拖到屏幕左/右边缘自动贴边并置顶；鼠标离开窗口 3 秒后缩进屏幕外，光标靠近该侧屏幕边缘即滑回；一旦展开到图4/图5 自动取消停靠。“吸附/缩进/唤出”以本机桌面实测为准可再调阈值
- **标签与置顶**：标签写在 frontmatter（跨文件夹统计，点标签条筛选，点「清除标签」退出）；置顶独立成区排在列表最前，可多选批量置顶；改文件夹名后当前浏览的文件夹会跟随（不再出现“空文件夹”假象）
- **待办聚合视图**：侧栏「☑️ 待办」把全库 `- [ ]` 汇总成一屏（未完成在前、按笔记更新时间倒序），勾选直接回写源文（未完成项勾掉后即从清单消失），点任务文本跳回原笔记并滚动定位、编辑器短暂高亮该行；可切换「显示已完成」（带删除线）；搜索框在聚合视图内按任务文本/笔记标题/文件夹过滤
- **格式工具栏**：编辑区上方按功能分组的按钮条（组间细竖线分隔），选中文字点按钮即套上对应 Markdown 语法、再点一次取消；未选中时插入空模板（代码块/表格/链接等）并把光标放在该填的位置；行首类（标题/列表/待办/引用）作用于选区覆盖的所有行，标题级别与列表类型互斥替换；`⋯ 更多` 收纳低频项（行内代码、分隔线）；撤销/重做走浏览器原生撤销栈，`Ctrl+Z`/`Ctrl+Y` 与按钮是同一套
- **设置（独立窗口，首版）**：
  - 入口：侧栏底部「⚙️ 设置」或快捷键 `Ctrl + ,`；桌面为独立窗口（`settings.html`），Web 预览为新浏览器窗口
  - 分类：通用（**主题** / 启动布局 / 记住面板）、快捷键（改键 / 冲突提示 / 恢复默认）、存储（路径展示 / 打开目录 / **更改位置并迁移**）、编辑器（默认视图 / 自动保存去抖 / 拼写检查）、窗口与吸附（开关 / 吸附侧 / 缩进延迟 / 置顶 / 热区宽度 / 仅侧栏生效）、关于（版本与数据位置）
  - 主题：三档（浅色 / 深色 / 跟随系统），立即生效并持久化；全部颜色走 CSS 变量（`web/src/main/app.css` 的 `[data-theme]` 两档 + 系统深色兜底），`<html data-theme>` 由窗口入口在挂载前同步写入，避免深色用户看到白底闪烁；「跟随系统」按 `prefers-color-scheme` 解析为具体档位，并在系统主题变化时**实时跟随**（只在 system 档订阅）
  - 存储：设置存 `settings.json`（应用配置目录）；存储位置指针存 `storage.json`；笔记与 `meta.json` 随笔记目录一起迁移，原目录保留作备份；目标目录须为空或仅含 `.md`/`meta.json`
  - 兼容：设置文件带 `version`，读取时未知字段原样保留（向后兼容）

## 技术栈与架构（对齐 TECH_DESIGN）

```
UI 层（Svelte 5 + TS）  web/src/main/*、web/src/shared/core-client.ts
Core 层（TS 同构实现）  web/src/lib/core/*   —— 文件读写、frontmatter、索引、搜索、事件、动作注册表
存储端口（可插拔）      web/src/lib/core/storage/*（TauriStorage / memory / IndexedDB）
Tauri 薄壳（Rust）      src-tauri/*           —— notes 目录真实文件读写 + meta.json KV + 设置/存储迁移命令
```

- `NoteCore`（[store.ts](web/src/lib/core/store.ts)）是**唯一事实源**：启动扫描建索引，所有读写/索引/搜索集中在 Core，UI 通过事件订阅同一份数据 —— 对应技术方案「数据层与 UI 解耦」。
- **P1 扩展预留**：
  - frontmatter 已含 `tags`/`pinned` 占位并原样保留未知扩展字段（改标签/置顶不动存储结构）；
  - `StoragePort` 即未来 Tauri 壳的接缝：以真实 fs 适配器（`%APPDATA%\<app>\notes\<id>.md`）替换 IndexedDB 实现即可，`core-client` 之上无需改动；
  - 动作注册表（[actions.ts](web/src/lib/core/actions.ts)）已支持快捷键→动作映射与冲突提示，P1 全局热键只需追加映射；
  - `demo/` 保留为浏览器原型与验收参考。

## 运行 / 构建 / 测试

要求：Node ≥ 24（核心 TS 由 Node 直接以类型擦除方式执行）。

```bash
npm install            # 先安装根脚本依赖说明（根无第三方依赖，仅脚本）
cd web && npm install  # 安装 web 依赖
npm run dev            # Vite dev server → http://localhost:5173/
npm test               # 全量单测（node:test；含迁移后的 markdown/store 行为基线 + demo 回归）
npm run build          # 生产构建到 web/dist
```

> 本机沙箱环境备注：安装依赖请用 `npm --prefix web install --ignore-scripts --no-audit --no-fund`，
> 并把 npm 缓存指到工作区（`npm_config_cache`），测试用 `--test-isolation=none`
> （环境限制生命周期脚本与子进程管道，见根 [package.json](package.json) 脚本默认值）。

### 真实浏览器冒烟（P0 验收点）

```bash
# 1) 先构建：npm run build
# 2) 静态托管产物：
node web/scripts/serve-dist.mjs            # http://127.0.0.1:5174/
# 3) 带 CDP 调试端口的 headless Chrome（独立临时 profile）：
chrome --headless=new --user-data-dir=%TEMP%\na-smoke-profile --remote-debugging-port=9222 about:blank
# 4) 跑冒烟（主窗口 107 项 + 设置窗口 25 项）：
SMOKE_URL=http://127.0.0.1:5174/ node web/scripts/ui-smoke.mjs
SMOKE_URL=http://127.0.0.1:5174/ node web/scripts/settings-smoke.mjs
```

人工验收参考（与冒烟断言一致）：右键文件夹/空白/笔记行出上下文菜单；拖拽文件夹调整顺序、
拖拽笔记到文件夹即移动、列表内拖动即手动排序（可“恢复时间序”）；删除的笔记/文件夹进入
回收站可整组还原；多选批量操作；面板级联展开/收回；设置窗口改键与冲突提示、存储位置迁移（桌面）。

## 发布 Release（GitHub）

远端：`https://github.com/Silicon-basedLife/note-book.git`

当前版本 `v0.1.0` 的发布说明见 [docs/RELEASE_NOTES_v0.1.0.md](docs/RELEASE_NOTES_v0.1.0.md)。
**注意：本版本不含“快速便签 / 悬浮窗”**（全局热键、托盘常驻属 P1 规划）。

三种发布方式：

1. **GitHub Actions 自动构建并发布（推荐）**——推送 tag 即自动跑测试 + 构建 MSI/NSIS/免安装 exe 并创建 Release：
   ```bash
   git push origin master
   git tag -a v0.1.0 -m "NoteApp 0.1.0"
   git push origin v0.1.0
   ```
   工作流：[.github/workflows/release.yml](.github/workflows/release.yml)；也可在 Actions 页面手动 Run workflow 并填入 tag。
2. **本地一键脚本**（在能访问 github.com 的普通终端执行）：
   ```powershell
   npm run release          # 测试 → 构建 exe → 推送 master 与 tag → 用 gh 创建 Release
   npm run release:draft    # 同上，但先建草稿 Release
   $env:NOTEAPP_BUNDLE='1'; npm run release   # 额外构建 MSI/NSIS（需能访问 github.com 下载 NSIS/WiX）
   ```
   脚本会附上 `NoteApp.exe`（若已构建安装包则一并附上）；未安装 `gh` 时会打印手动创建 Release 的步骤。
3. **纯手动**：`git push origin master` + 推送 tag，然后在 GitHub「Releases → Draft a new release」选择 tag 并上传 `src-tauri\target\release\NoteApp.exe`（或 `bundle\msi\*.msi`、`bundle\nsis\*-setup.exe`）。

## 目录结构

```
docs/                     # 产品路线图 + 技术方案（需求来源）
src-tauri/                # Tauri 2 薄壳：文件/KV 命令、窗口配置、图标、bundle
web/
  src/lib/core/           # 核心逻辑（TS 同构；未来可逐步下沉到 Rust core）
  src/lib/settings/       # 设置模型/读写/快捷键（主窗口与设置窗口共用）
  src/lib/desktop/        # 桌面能力：侧边吸附（dock-core 纯逻辑 + side-dock 运行时）+ 主题运行时（theme.ts）
  src/shared/             # core-client（UI 装配入口，按环境选存储适配器）
  src/main/               # 主窗口（App.svelte + app.css + main.ts）
  src/settings/           # 独立设置窗口（Settings.svelte + main.ts）
  scripts/                # serve-dist.mjs、ui-smoke.mjs、settings-smoke.mjs（CDP 冒烟）
scripts/                  # setup.ps1（桌面一键构建）
tests/                    # node:test 套件：core.* 迁移基线 + demo 回归
demo/                     # 纯前端原型（参照保留）
```

## 验证状态

- 单元/集成测试：全绿（`npm test`，**206 项**，见各 `tests/*.test.mjs`；测试文件按覆盖层命名，约定见 [tests/README.md](tests/README.md)；含 `tests/theme.css.test.mjs` 对“颜色必须走主题变量”的样式契约校验、`tests/core.md-format.test.mjs` 对格式工具栏的逐字断言）；
- **规范门禁：`npm run verify` 退出码 0** —— 单测 + `tsc --noEmit` + Prettier `--check`（仅 `.ts`/`.mjs`）+ `cargo fmt --check` + `cargo clippy -D warnings`；CI 执行同样五项。格式与行尾约定见 [.editorconfig](.editorconfig) 与 [.gitattributes](.gitattributes)；
- `tsc --noEmit` 通过；`vite build` 通过（双页产物：主窗口 + 设置窗口；**构建会报 Svelte 警告，请留意**——2026-10-01 就是从构建输出里发现了 26 条长期无人查看的警告，见 [PROGRESS §1.16](docs/PROGRESS.md)）；
- 真实 Chrome 端到端冒烟：**主窗口 107/107、设置窗口 25/25** 通过（默认仅侧栏 / 面板级联与手柄 / 右键菜单 / 拖拽排序移动 / 手排 / 回收站还原批量 / 多选 / 含回收站搜索 / 设置改键与冲突 / 主题切换、持久化与实时跟随系统 / 标签添加·筛选·移除与置顶分区 / 待办聚合、勾选回写与跳转定位 / 格式工具栏逐字比对、撤销重做、高亮渲染与折叠区 / **宽度分配、可拖拽分隔条与不留白** / 无控制台错误）。
