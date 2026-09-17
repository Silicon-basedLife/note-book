# NoteApp 进度与交接（PROGRESS / HANDOFF）

> 用途：上下文交接。新对话请先读本文件，再读 `AGENTS.md`、`README.md`、`docs/ROADMAP.md`、`docs/TECH_DESIGN.md`。
> 记录时间：HEAD = `dfbf888`（工作树干净）。
> 一句话现状：**P0 MVP 全部完成并已在你的 Windows 桌面端跑通**；在此之上完成了大量增强（回收站、拖拽、多选、面板级联、独立设置窗口、存储迁移、QQ 式侧边吸附）。当前**只差你在本机重新构建一次并确认最新两处修复 + 桌面交互手感**。

---

## 0. 新对话上手（必读）

### 0.1 仓库地图

```
docs/ROADMAP.md        产品需求（P0/P1 范围与验收）
docs/TECH_DESIGN.md    技术方案（Tauri 2 + Svelte + TS 三层架构）
docs/PROGRESS.md       本文件（进度与交接）
AGENTS.md              约定：每次改动必须 Git commit；测试/验证全绿才交付
README.md              运行/构建/测试/冒烟说明、功能清单、验证计数

src-tauri/             桌面壳（Rust 薄壳，唯一职责：文件读写 / 设置 / 存储迁移）
  src/fs_store.rs        全部命令：笔记文件、meta KV、settings、storage 指针、迁移、打开目录、选择目录
  src/lib.rs             注册命令
  tauri.conf.json        两个窗口：main（232×760，可收缩）+ settings（820×620，visible:false）
  capabilities/default.json  权限（含 set-size/set-position/always-on-top/show/hide/set-focus/
                              create-webview-window/event emit+listen）
web/                   前端（Svelte 5 + TS + Vite，双页产物）
  src/lib/core/         核心逻辑（与 Rust 解耦，纯 TS，单测覆盖）
  src/lib/settings/     设置模型/归一化/读写/快捷键（主窗口与设置窗口共用）
  src/lib/desktop/      side-dock（QQ 吸附运行时）+ dock-core（纯计算，单测覆盖）
  src/shared/           core-client（按环境选存储适配器）
  src/main/             主窗口（App.svelte、app.css、main.ts、ui/ContextMenu.svelte）
  src/settings/         独立设置窗口（Settings.svelte、main.ts）
  scripts/              serve-dist.mjs（静态托管）、ui-smoke.mjs（主窗口冒烟）、settings-smoke.mjs（设置窗口冒烟）
scripts/setup.ps1       桌面一键构建（装 Rust → 装依赖 → tauri build --no-bundle）
tests/                  102 项 node:test（core.* + demo 回归）
demo/                   浏览器原型（已被另一次改动升级为“文件夹+笔记双实体 + IndexedDB”，见 commit a1cba63）
```

### 0.2 本沙箱环境的硬限制（务必先看，否则会踩坑）

| 事项 | 做法 |
|---|---|
| npm 安装 | 必须清空 `npm_config_allow_scripts` 且缓存指向工作区：`$env:npm_config_allow_scripts=''; $env:npm_config_cache='E:\AI学习\note-app\.npm-cache'; npm install --ignore-scripts`（本机用户级 `.npmrc` 配了 `allow-scripts=["pnpm"]`，项目级安装会直接 EALLOWSCRIPTS） |
| 单测 | `node --test --test-isolation=none "tests/**/*.test.mjs"`（必须 `--test-isolation=none`，沙箱禁止测试子进程管道） |
| 构建/冒烟/build | `vite build` 需要 esbuild spawn 管道 → **必须以 `danger-full-access` 升级执行**（本会话内已多次获批，属正常流程） |
| 冒烟 | 1) `node web/scripts/serve-dist.mjs`（5174）；2) headless Chrome `--remote-debugging-port=9222 --user-data-dir=%TEMP%\...`；3) `$env:SMOKE_URL='http://127.0.0.1:5174/'; node web/scripts/ui-smoke.mjs`（另有 settings-smoke.mjs）。两个冒烟会先清空 localStorage/IndexedDB 以保证确定性 |
| **Rust 无法在本沙箱编译** | 没有 cargo/rustc，且 Rust 下载源被网络策略拦。**所有 Rust 改动只能在用户机器上 `npm run desktop:setup` 验证**。改动 Rust 后必须明确告知用户重建，并请他回贴 cargo 输出 |
| 构建产物 | `npm run desktop:setup` = 结束正在运行的 `noteapp.exe` → 装依赖 → `tauri build --no-bundle` → 产出 `src-tauri/target/release/NoteApp.exe`（MSI/NSIS 需 github 可达：`npm run desktop:build`） |

### 0.3 数据位置（两个目录的区别，用户已多次问过）

| | 笔记目录（可改：设置 → 存储 → 迁移） | 应用数据目录（不可改，Windows 固定） |
|---|---|---|
| 例子 | `E:\AI学习\笔记` | `C:\Users\ASUS\AppData\Roaming\com.noteapp.desktop` |
| 内容 | `n-xxxxxxxx.md`（一笔记一文件，frontmatter 自带标题/文件夹/时间/回收站标记）+ `meta.json`（文件夹顺序、手排、回收站文件夹登记） | `settings.json`（偏好）、`storage.json`（指针 `{"notesDir":"E:\\AI学习\\笔记"}`）、默认 `notes\`（迁移前的旧副本） |
| 删除后果 | 笔记全丢 | 只丢设置与指针：笔记文件仍在，但应用回落到默认 `notes\`，表现为“笔记不见了” |
| 备份 | **只需备份这个目录** | 可选（丢了只是重置设置、需重新指一次目录） |

> 注意：`notes_root()` 会在每次命令时确保目录存在；`storage.json` 指向默认目录时会被视为“未自定义”并自动清理。

---

## 1. 已完成

### 1.1 P0 MVP（ROADMAP 验收项，全部完成）

| 功能 | 实现位置 | 验证 |
|---|---|---|
| 笔记列表 + 新建/删除/重命名 | `web/src/main/App.svelte` + `lib/core/store.ts` | 冒烟 51/51；用户在桌面端使用过 |
| Markdown 编辑 + 实时预览（编辑/分屏/预览） | `lib/core/markdown.ts`、`App.svelte` | 单测 core.markdown + 冒烟 |
| 去抖自动保存 + “已保存/未保存/保存中”状态 | `App.svelte`（写队列串行化） | 冒烟；去抖可配（设置） |
| 主窗口全文搜索（标题+正文、命中高亮、跳转） | `lib/core/search.ts`、`index.ts` | 单测 core.search + 冒烟 |
| 一级文件夹分类（新建/重命名/删除、移动笔记） | `core/store.ts`、`App.svelte` | 单测 + 冒烟 |
| 代码块语法高亮 | `lib/core/markdown.ts`（highlight.js） | 单测 + 冒烟 |
| 待办勾选回写源文 `- [ ]` → `- [x]` | `core/tasks.ts` + `markdown.ts` 偏移注入 | 单测 + 冒烟 |
| 纯本地存储：一笔记一 `.md` + frontmatter | `core/frontmatter.ts`、`storage/tauri.ts`、`src-tauri/src/fs_store.rs` | 单测往返 + 用户桌面端实测 |
| 桌面可执行程序 | `src-tauri/`、`scripts/setup.ps1` | 用户已多次构建运行成功 |

### 1.2 增强交互（用户逐条提的需求，已完成）

- 右键菜单：文件夹（其中新建/新建文件夹/重命名/删除进回收站）、列表空白、笔记行（移入回收站/还原/彻底删除）、回收站文件夹
- 回收站：软删除（frontmatter `deleted/deletedAt`）、单条/整组还原、彻底删除、清空、数量显示、文件夹整组进回收站
- 多选批量：选择模式 / Ctrl / Shift / 全选 → 批量移入回收站 / 还原 / 彻底删除（带确认）
- 拖拽（**指针事件实现，非 HTML5 DnD**，因为 WebView2 下 HTML5 拖放不生效）：
  - 文件夹拖拽排序（插入指示线、持久化）
  - 笔记拖到文件夹即移动、拖到回收站即删除、列表内拖拽手排（可“恢复时间序”）
- 文件夹：▶/▼ 手风琴、悬停数字变 ✕（已修右对齐）、双击重命名
- 面板级联（图3/图4/图5）：默认仅侧栏；点文件夹滑出列表、点笔记滑出编辑区；再点同类或边缘手柄逐级收回；**窗口宽度随开合自动缩放**（`computeWidth` + `applyWindowWidth`，注意 `$effect` 必须无条件读 `listOpen/editorOpen` 才能建立依赖）
- 搜索包含回收站命中（🗑️ 标记，点击转回收站只读查看）
- QQ 式侧边吸附（`lib/desktop/side-dock.ts`）：越界/接触屏幕左右边即吸附（无屏内磁吸）→ 贴边 + 垂直居中 + 置顶；鼠标离开窗口 3 秒 → 平滑滑出；光标进入屏幕边缘热区 → 平滑滑回；拖离超过 80px 取消停靠；展开面板自动取消停靠（仅图3 生效）

### 1.3 设置（独立窗口，首版，用户确认的三项决定）

- 独立窗口 `settings.html`（Tauri 第二窗口，关闭时**隐藏不销毁**，找不到时按需重建）
- 六个分类：通用 / 快捷键 / 存储 / 编辑器 / 窗口与吸附 / 关于
- 快捷键：动作列表、捕获改键（Esc 取消、Backspace 清除）、冲突提示、单项/全部恢复默认（`shortcuts` 为“当前覆盖集合”，删除必须生效；未知动作 id 才保留）
- 存储：显示三个路径（camelCase 契约，前端还兼容 snake_case）、打开目录（有成功/失败反馈）、**浏览…（系统原生文件夹选择，rfd）**、**验证并迁移**（校验目标为空或仅 `.md`/`meta.json` → 复制 → 写 `storage.json` 指针 → 失败不改配置）
- 编辑器：默认视图、自动保存去抖（200–2000ms）、拼写检查
- 窗口与吸附：开关、吸附侧、缩进延迟、置顶、热区宽度、仅侧栏生效
- 关于：版本、数据位置
- 设置文件 `version` + 未知字段原样保留（向前兼容）

### 1.4 桌面壳与构建

- Rust 薄壳：`list/read/write/remove_note_file`、`read/write/remove_meta`、`read/write_settings`、`get_storage_info`、`open_path`、`pick_folder`、`migrate_notes`
- 权限、双窗口配置、应用图标（`src-tauri/icons/`）
- `scripts/setup.ps1`：ASCII 化（避免 PowerShell 5.1 编码问题）、自动结束运行中的 `noteapp.exe`（避免 exe 被占用）、`--no-bundle` 默认产出可运行 exe
- README 全量说明；`demo/` 保留为原型（另有一次提交 `a1cba63` 把它升级成文件夹+笔记双实体 + IndexedDB，并带自己的测试）

### 1.5 验证现状（本沙箱）

- **单元/集成测试：102 项全绿**（`npm test`）
- **真实 Chrome 冒烟：主窗口 51/51、设置窗口 14/14**
- `tsc --noEmit` 通过；`vite build` 通过（双页产物）
- 覆盖点：frontmatter 往返、回收站全流程、手排/文件夹排序、搜索转义、Markdown/XSS、动作注册表、设置归一化/冲突/未知字段、存储字段契约、QQ 吸附纯计算、UI 面板宽度断言

---

## 2. 待你在本机确认（未验证 / 未确认）

> 这些改动本沙箱都无法验证（要么是 Rust，要么是原生窗口交互）。请 `npm run desktop:setup` 后按顺序确认：

1. **最新提交 `dfbf888`**：存储页的“当前笔记目录”不再显示 `\\?\` 前缀；若指针指向默认目录，界面显示“未自定义”且冗余 `storage.json` 被清理。
2. **`rfd` 原生目录选择**（`128f7d5` 引入）：`cargo` 是否能成功拉取 `rfd = "0.15"` 并编译；「浏览…」是否弹出系统选择文件夹对话框。
3. **迁移完整流程**：选一个空目录 → 验证并迁移 → 提示成功、三个路径刷新、重启应用后仍是新目录、原目录文件保留。
4. **侧边吸附手感**（最近改动未确认）：拖到屏幕左/右越界即吸、垂直居中、置顶；鼠标移开 3 秒平滑滑出；光标贴近屏幕边缘滑回。若与系统“半屏贴靠”仍打架或手感不对，记录现象（越界多少才吸？滑出快慢？热区宽窄？）再调 `side-dock.ts` 顶部常量。
5. 顺带确认上一轮已修的：快捷键点“默认”不再回弹；设置窗口关闭后能再次打开。
6. **发布确认**：按 §8 推送并创建 Release（`v0.1.0`，说明中已注明“不含快速便签/悬浮窗”），确认 Release 里能看到 `NoteApp.exe`（用 Actions 构建则还有 MSI/NSIS）。

---

## 3. 未实现（功能待办）

### 3.1 P1（ROADMAP 里明确列出的，尚未做）

| 功能 | 备注 |
|---|---|
| 主题（浅色/深色/跟随系统） | CSS 变量已具备条件；这是设置里最容易补的一项 |
| 标签系统 / 笔记置顶（pin） | frontmatter 已预留 `tags`/`pinned` 字段并可无损往返 |
| 多级目录 | 目前一级 |
| 待办聚合视图（汇总所有未完成） | |
| 附件：粘贴/拖拽图片入库 | 需定附件目录规则（存储页已留“附件目录”讨论位） |
| 命令面板（Ctrl+K 已用于搜索聚焦）+ 全局热键设置页 | 动作注册表已就绪，只需接 Tauri global-shortcut 插件 |
| 悬浮速记/快搜窗（P1 重点） | 需第二窗口 + tray；当前设置窗口提供了多窗口样板 |
| 托盘常驻 / 关窗不退 | |
| **屏幕边缘自动隐藏（真·OS 级）** | 现为“窗口内收边 + 越界吸附缩进”，与系统贴靠共存；如需完全禁用系统贴靠需另想办法 |
| 回收站自动清理策略（永久/30天） | 存储页已留位 |
| 笔记历史版本 | |
| 导出 HTML / PDF | PDF 需评估 Tauri 打印能力 |
| 字数统计扩展（词/行） | 已有字符数 |
| 设置项搜索、快捷键方案导入导出 | |

### 3.2 低风险可选增强（已向用户提议，未得到明确选择）

- 迁移前自动 zip 备份（保留最近 N 份）
- 启动校验：`storage.json` 指向目录不存在时弹提示（重新选择 / 回退默认），避免“静默回落看起来像丢笔记”
- “直接指向已有笔记目录（不复制）”：换电脑时直接接上已有目录（目前“验证并迁移”是复制语义，目标已有笔记时会复制覆盖同名文件）

### 3.3 技术债 / 已知小问题（不影响功能）

- Svelte 编译告警：若干 `a11y_*`（div 带 click/contextmenu 缺 role/键盘处理）与 `core` 未用 `$state` 的 non_reactive 提示；构建通过，属提示。
- Rust 侧没有本地编译验证通道（无 cargo），依赖用户机器构建；建议每次改 Rust 后让用户回贴 cargo 输出。
- `demo/` 与被 `a1cba63` 升级后的 `demo/js/db.mjs`、`tests/store.test.mjs` 相关测试仍在跑，属于原型层，不影响生产实现。

---

## 4. 下一个对话的指示（直接照着做）

### Step 0：恢复上下文
1. `git status` 确认干净；`git log --oneline -5` 确认 HEAD（交接时是 `dfbf888`）。
2. 读 `docs/PROGRESS.md`（本文件）→ `AGENTS.md` → `README.md`。
3. 跑一遍基线：`node --test --test-isolation=none "tests/**/*.test.mjs"`（应 102 通过）。

### Step 1：先收口“待确认项”
- 让用户执行 `npm run desktop:setup`，按 §2 的 1–5 条逐项确认。
- 有报错就修；Rust 报错优先看 `src-tauri/src/fs_store.rs` 与实际 cargo 输出。

### Step 2：按优先级做新功能（每次一项，走完整闭环）
建议顺序（先易后难、先低风险）：
1. **主题（浅/深/跟随系统）**：`settings/coerce.ts` 加 `general.theme`，`app.css` 变量化 + `prefers-color-scheme`，设置页加选项，用冒烟断言切主题后 `document.documentElement.dataset.theme`。
2. **启动校验 + 迁移前 zip 备份**（§3.2）：Rust 加 `validate_storage`/`backup_notes` 命令，设置页给开关；补单测（纯逻辑）+ 更新 README。
3. **命令面板 + 全局热键**：动作注册表扩展，Tauri `global-shortcut` 插件 + 设置页热键页签；冲突检测复用 `findShortcutConflict`。
4. **悬浮速记/快搜窗**：以设置窗口为样板加第三窗口 + tray（`tauri-plugin-*` 需新增依赖，注意让用户本机构建验证）。
5. **导出 HTML / 字数统计 / 标签 / 置顶** 等按需推进。

### Step 3：每项改动的固定动作（AGENTS.md 要求）
1. 先写/改测试（core 纯逻辑放 `tests/core.*.test.mjs`；设置相关放 `tests/core.settings.test.mjs`/`core.storage-info.test.mjs`）。
2. 跑：`node --test --test-isolation=none "tests/**/*.test.mjs"` + `npm --prefix web run typecheck`（都应为 0）。
3. 若动前端：`npm --prefix web run build`（需 `danger-full-access` 升级）→ 起 `serve-dist.mjs` + headless Chrome(9222) → 跑 `ui-smoke.mjs`、`settings-smoke.mjs`；必要时给冒烟**加断言**再跑。
4. 若动 Rust：明确告诉用户需要重建，并在答复里列出“请确认项”。
5. **提交 Git**（消息写清动机与验证结果；不要 `git add` `src-tauri/target`、`src-tauri/gen`，已在 `.gitignore`）。

### Step 4：交付话术模板
- 改了什么 / 为什么
- 本沙箱验证结果（测试数、冒烟数、build/tsc）
- 需要用户本机确认的清单（含 `npm run desktop:setup`）
- 风险与回退方式（改了 Rust 尤其要写）

---

## 5. 关键文件速查

| 想改… | 看这里 |
|---|---|
| 数据模型 / 文件格式 | `web/src/lib/core/types.ts`、`frontmatter.ts` |
| 回收站 / 文件夹 / 手排逻辑 | `web/src/lib/core/store.ts`（`deleteNotes/restoreNote/purgeNote/deleteFolder/restoreFolder/setNoteOrder/listNotesOrdered`） |
| 搜索 | `web/src/lib/core/search.ts`、`index.ts` |
| Markdown / 待办回写 | `web/src/lib/core/markdown.ts`、`tasks.ts` |
| 主窗口全部交互 | `web/src/main/App.svelte`（面板级联、拖拽指针事件、右键菜单调用、窗口宽度同步） |
| 右键菜单组件 | `web/src/main/ui/ContextMenu.svelte` |
| 设置模型/合并/快捷键 | `web/src/lib/settings/*.ts` |
| 设置窗口 UI | `web/src/settings/Settings.svelte` |
| 存储信息契约 | `web/src/lib/settings/storage-info.ts`（后端字段 camelCase 契约） |
| 侧边吸附 | `web/src/lib/desktop/side-dock.ts`（常量在文件顶部）、`dock-core.ts`（纯计算+单测） |
| Rust 命令 | `src-tauri/src/fs_store.rs`（所有命令）、`src-tauri/src/lib.rs`（注册） |
| 权限/窗口配置 | `src-tauri/capabilities/default.json`、`src-tauri/tauri.conf.json` |
| 构建脚本 | `scripts/setup.ps1`、根 `package.json` 脚本 |
| 发布 | `scripts/release.ps1`、`.github/workflows/release.yml`、`docs/RELEASE_NOTES_v0.1.0.md`（详见 §8） |

---

## 6. 用户已确认的决策记录（不要再反复问）

- 实现形态：**Tauri 2 桌面软件**（文档选型），Web 版仅作为开发预览
- 面板形态：**三栏 + 中间栏展开**（不是左栏内嵌树）
- 排序：**手动排序优先 + 可一键切回时间序**（不持久化“永久手排”以外的东西都在 `meta.json`）
- 面板开合：**默认图3（仅侧栏）、不记忆**（设置里另有“记住面板”开关）
- 收起方式：**再点同类收起 + 边缘手柄**
- 旧“收边窄条”：**弃用**，改为面板级联 + 窗口自适应
- 侧边吸附：**仅图3 生效、左右都支持、完全隐藏 + 光标热区唤出（方案2）、缩进后置顶**
- 设置面板形态：**独立窗口**
- 存储位置：**首版就要能更改并迁移**
- 每次改动：**Git commit + 测试全绿**（AGENTS.md）

---

## 7. 复现验证的最短命令

```powershell
# 单测（102）
node --test --test-isolation=none "tests/**/*.test.mjs"

# 类型检查
npm --prefix web run typecheck

# 构建（需 danger-full-access 升级：esbuild 要 spawn）
npm --prefix web run build

# Web 冒烟（两个窗口）
node web/scripts/serve-dist.mjs                      # 终端 A：5174
chrome --headless=new --user-data-dir=%TEMP%\na-smoke --remote-debugging-port=9222 about:blank   # 终端 B
$env:SMOKE_URL='http://127.0.0.1:5174/'; node web/scripts/ui-smoke.mjs        # 51 项
$env:SMOKE_URL='http://127.0.0.1:5174/'; node web/scripts/settings-smoke.mjs  # 14 项

# 桌面构建与自测（用户本机）
npm run desktop:setup     # 产出 src-tauri\target\release\NoteApp.exe
```

---

## 8. 发布到 GitHub（Release）

- 远端：`https://github.com/Silicon-basedLife/note-book.git`（分支 `master`）
- 当前版本：`0.1.0`（`package.json` / `web/package.json` / `src-tauri/tauri.conf.json` / `Cargo.toml` 一致）；tag 用 `v0.1.0`
- **本沙箱无法推送**：GitHub 不可达，且沙箱禁止 git 的辅助进程管道（`couldn't create signal pipe`）+ 无凭据。**必须由用户在有网终端执行**。
- 已就绪的发布脚手架：
  - 发布说明：`docs/RELEASE_NOTES_v0.1.0.md`（首屏即声明“本版本不含快速便签/悬浮窗”）
  - Actions 工作流：`.github/workflows/release.yml` —— 推 `v*` tag 或手动 dispatch，在 windows runner 上跑单测/typecheck → `tauri-action` 构建 MSI+NSIS+exe → 自动创建 Release 并上传产物（**推荐**，runner 可正常下载 NSIS/WiX）
  - 本地脚本：`scripts/release.ps1`（根脚本 `npm run release` / `release:draft`）—— 测试 → 构建 exe（`NOTEAPP_BUNDLE=1` 时连安装包）→ `git push master` + tag → 有 `gh` 则自动建 Release，否则打印手动步骤
- 命令（用户终端）：
  ```powershell
  git push origin master
  git tag -a v0.1.0 -m "NoteApp 0.1.0"
  git push origin v0.1.0          # 之后由 Actions 自动出 Release（含安装包）
  # 或本地一键：npm run release（需要 gh CLI 才会自动创建 Release）
  ```
- 下一个对话注意：**不要尝试在沙箱内 push**；如用户报告 Actions 失败，先看 workflow 日志（常见点：`npm ci` 锁文件不同步、tauri-action 版本、bundle 目标）。
