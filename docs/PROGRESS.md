# NoteApp 进度与交接（PROGRESS / HANDOFF）

> 用途：上下文交接。新对话请先读本文件，再读 `AGENTS.md`、`README.md`、`docs/ROADMAP.md`、`docs/TECH_DESIGN.md`。
> 记录时间：HEAD = `144ede7`（回车即换行；其前 `93434ae` 布局修复、`5f7c26f` 使用教程、`30f216f` 格式工具栏、`14e4f0e` 待办聚合、`67d92d2` 标签+置顶、`f2c7bd7` 主题收尾、`d904eca` 主题、`518875e` v0.1.0 发布脚手架）。
> 一句话现状：**P0 MVP 全部完成并已在你的 Windows 桌面端跑通**；在此之上完成了大量增强（回收站、拖拽、多选、面板级联、独立设置窗口、存储迁移、QQ 式侧边吸附、**主题**）。当前**只差你在本机重新构建一次并确认 §2 的清单（含主题观感）**。

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

### 1.6 主题（浅色 / 深色 / 跟随系统）（本轮新增）

| 事项 | 实现位置 |
|---|---|
| 设置模型：`general.theme`（`'light' \| 'dark' \| 'system'`，默认 `light`） | `web/src/lib/settings/types.ts`（`THEME_MODES` / `DARK_QUERY` 与运行时共用同一份常量） |
| 归一化：非法/缺省值回退 `light`，未知字段照旧保留 | `web/src/lib/settings/coerce.ts`（`pickEnum(g.theme, THEME_MODES, …)`） |
| 主题运行时：`resolveTheme`（纯函数）/ `applyTheme` / `applyCachedTheme` / `applyThemeMode` / `watchSystemTheme` / `ThemeFollower` | `web/src/lib/desktop/theme.ts` |
| 实时跟随系统：`prefers-color-scheme` 变化即重算；**只有档位是 system 时才订阅**，切走自动释放 | `theme.ts` 的 `ThemeFollower`（App.svelte 持有实例、卸载时 `stop()`；Settings.svelte 在 `$effect` 里 update + 返回清理） |
| 配色变量：`:root[data-theme='light']` 与 `:root[data-theme='dark']` 两档同构变量集（各 40+ 个 token）+ `color-scheme` | `web/src/main/app.css` |
| 系统深色兜底：脚本执行前 `@media (prefers-color-scheme: dark)` 只覆盖大面积底色 | `web/src/main/app.css`（`:root:not([data-theme])`） |
| 首屏防闪：两个入口 HTML 的 head 内联引导脚本（读 localStorage 快照 → 写 `data-theme`） | `web/index.html`、`web/settings.html` |
| 挂载前同步应用 + 读到设置后精确应用 + 跨窗口同步 | `web/src/main/main.ts`、`web/src/settings/main.ts`、`App.svelte`（loadSettings / subscribeSettings）、`Settings.svelte`（`$effect` + 选择器） |
| 设置页 UI：通用 → 主题三项 chip（含当前解析结果提示） | `web/src/settings/Settings.svelte`（`data-theme-choice` 供冒烟定位） |
| 测试 | `tests/core.theme.test.mjs`（13 项：归一化/解析/DOM 应用/快照容错/监听订阅与释放）、`tests/theme.css.test.mjs`（5 项：两档变量同构、无硬编码色、引导脚本就位） |
| 冒烟断言 | 主窗口 4 项（默认浅色 → 深色重载保持 → 清设置回浅色 → 弹窗宽度未被边框撑宽）、设置窗口 10 项（深色立即生效 + 持久化、跟随系统与系统偏好一致、切回浅色、非 system 档不挂监听、系统主题变化实时跟随、切走后释放监听） |

设计取舍（下次改主题请先看）：
- 默认 `light` 而不是 `system`：不因系统深色让既有用户“静默变脸”；要改默认值只需动 `DEFAULT_SETTINGS.general.theme`。
- **实时跟随只在 `system` 档发生**：显式选了浅/深就完全不订阅 `matchMedia`，避免无谓回调；`ThemeFollower` 记录当前档位，同档重复 update 不重建订阅。
- 老 WebView 若 `MediaQueryList` 没有 `addEventListener`（或环境无 `matchMedia`）→ 静默降级为不订阅，不影响主题本身生效。
- 代码块高亮配色与深色代码底色固定，不随主题切换（GitHub Dark 风格，深浅两档下都可读）。
- 弹窗浮层用 flex 而非 grid 居中：`.panel` 带 1px 边框，grid 会把边框算进 `min(440px, 92vw)` 导致弹窗被撑宽 2px（已有冒烟断言看着）。
- `theme.css.test.mjs` 会拦下任何新增的硬编码颜色：新增颜色请先加到两档变量里（白名单只有 `--mono` 这类与主题无关的 token）。

### 1.7 标签与置顶（本轮新增）

| 事项 | 实现位置 |
|---|---|
| 标签纯逻辑：`normalizeTag`（去 #、剔控制字符、折叠空白、截断 24 字）/ `parseTagInput`（空格/逗号/顿号/分号分隔，大小写不敏感去重保序）/ `mergeTags` / `removeTag` / `hasTag` / `countTags` | `web/src/lib/core/tags.ts`（新增） |
| 置顶排序：`sortPinnedFirst` 包在 `liveDocsIn` 上（时间序也置顶优先）；`listNotesOrdered` 拆出 `applyManualOrder`，**置顶区内用手排、非置顶区另算**，两区拼接 | `web/src/lib/core/store.ts` |
| 索引补 `pinned` | `web/src/lib/core/types.ts`（`IndexEntry.pinned`）、`web/src/lib/core/index.ts`（`entryFromDoc`） |
| UI：编辑区「📌 置顶」按钮 + 标签编辑行（chip + 输入框，回车添加、Backspace 删末尾、失焦提交）；列表标签筛选条（`#tagbar` / `data-tag`）；行内 📌 徽标与 `#标签` 摘要；多选批量置顶/取消置顶；行右键「置顶/取消置顶」 | `web/src/main/App.svelte`（含样式见 `app.css` 的「标签与置顶」段） |
| 拖拽与置顶分区：拖动项与落点分区不一致时忽略并提示（不写手排），避免手排与置顶互相打架 | `App.svelte` 的 `commitReorderWith` |
| 搜索：标签不参与全文检索（搜索仍只搜标题+正文），标签是独立的筛选维度 | 无需改动 `search.ts` |
| 测试 | `tests/core.tags-pin.test.mjs`（9 项：规范化/解析/合并/计数、索引带 pinned、置顶时间序与手排分区、写盘+重启恢复、回收站不参与） |
| 冒烟断言 | 主窗口 15 项：标签添加→筛选条→按标签筛选→幂等保持→清除→移除后自动退出筛选；置顶按钮→首行徽标→列表头条数→右键菜单项→重载保持→取消置顶（共 74 项） |

顺手修掉的两个真实缺陷（本轮发现）：
1. **Svelte 5 响应式陷阱**：`$derived` 不会追踪“被调用函数内部”读取的状态，原先写成 `countTags(core.listNotesOrdered(...))` 只会算一次（首次空库）且永不更新 → 标签筛选条永远不出现。现改为 `refresh()` 里显式更新 `allTags` state，`tagChips` 只做纯条件包装。
2. **重命名当前文件夹后列表变空**：`activeFolder` 仍指向旧名 → 列表显示“这个文件夹还没有笔记”。现在改名会跟随，且新增兜底横幅（文件夹名已不存在时提示并给「查看全部笔记」出口）。

设计取舍（下次改这块请先看）：
- 标签条统计的是**全部笔记**的标签（跨文件夹导航维度），不是当前文件夹；筛选本身仍只作用于当前列表。
- 点标签是**幂等筛选**（不做 toggle），退出筛选用「清除标签」按钮，避免“点了没反应”的歧义。
- 置顶是**独立分区**，不写进 `meta.json` 的手排数组：拖拽跨分区被拦并提示，改置顶状态不需要重排。

### 1.8 待办聚合视图（本轮新增）

| 事项 | 实现位置 |
|---|---|
| 聚合纯逻辑：`extractTaskLines`（按行扫描，识别 `-`/`*`/`+` + `[ ]`/`[x]`/`[X]`，给出标记偏移、行号、去标记文本）、`collectTodos`（未完成在前 → 笔记更新时间倒序 → 同笔记按行号）、`countTodos`、`filterTodos` | `web/src/lib/core/todos.ts`（新增） |
| 与预览的关系：**互不牵连**。预览端（`markdown.ts`）仍用 markdown-it 的 `token.map` + 行内 `index` 定位；聚合端直接按行扫描 body。两者都保证 offset 指向任务行标记，因此都能直接喂 `tasks.toggleTask` 回写 | `markdown.ts` 顶部已写清这条边界 |
| `tasks.ts` 的标记正则由 `[-*]` 放宽为 `[-*+]`（与 `markdown.ts` 的 `MARKER_RE` 一致），并导出 `TASK_MARKER_RE` 供聚合复用 | `web/src/lib/core/tasks.ts` |
| UI：侧栏「☑️ 待办」（带未完成角标）→ 列表栏渲染 `.todo-row`（checkbox + 任务文本 + `📄 标题 · 文件夹 · 第 N 行`）；勾选即 `core.toggleTask` 回写并重算；点任务文本 `openTodoSource()` 跳回笔记、按比例滚动文本框并给编辑器加 `.todo-flash` 1.8s 高亮；「显示已完成」切换（`#todo-show-done`） | `web/src/main/App.svelte`、`app.css` 的「待办聚合视图」段 |
| 视图状态：`view` 由 `'notes' \| 'trash'` 扩为 `+ 'todos'`；`todoItems`/`todoCounts` 在 `refresh()` 里更新（避免 Svelte 5 派生陷阱）；搜索框在聚合视图内走 `filterTodos` | `App.svelte` |
| 测试 | `tests/core.todos.test.mjs`（13 项：行扫描语义与边界、CRLF、偏移可回写、汇总排序、计数、过滤、勾选后聚合结果变化） |
| 冒烟断言 | 主窗口 9 项：待办入口 → 视图渲染任务行 → 来源信息 → 勾选后从未完成清单消失 → 显示已完成（删除线）→ 点任务跳回源笔记 → 编辑器高亮 → 回到全部笔记（共 83 项） |

设计取舍：
- 排序口径：未完成恒在前；已完成项按笔记更新时间倒序（不是按勾选时间——勾选时间没有落盘字段，避免为此改存储格式）。
- 已完成任务默认不显示（聚合视图的用途就是“还剩什么没做”），需要复盘时用「显示已完成」。
- 跳转定位用“按行号比例估算 `textarea.scrollTop`”而不是精确滚动：`textarea` 无法按字符偏移精确滚动，比例估算在长文里已足够把目标行带进视口。
- 聚合只读**活跃笔记**（`core.listNotes()`），回收站里的任务不参与汇总。

### 1.9 Markdown 格式工具栏（本轮新增）

> 起因：用户提出「不太会用 Markdown，不会加粗/斜体/代码块」。讨论后的结论是**不要让用户背符号**，
> 用一组按钮替他把语法打好；同时明确不做富文本（会破坏“笔记是纯文本”的根基）。

| 事项 | 实现位置 |
|---|---|
| 纯逻辑：`toggleWrap`（行内包裹/取消，同字符标记按“层”判定）、`toggleLinePrefix`（行首前缀，互斥前缀按最长匹配归属）、`toggleOrderedList`（逐行编号）、`codeBlock`/`link`/`table`/`horizontalRule`（块插入）、`FORMAT_BUTTONS`/`FORMAT_GROUPS`/`FORMAT_SHORTCUTS` 目录 | `web/src/lib/core/md-format.ts`（新增） |
| 统一表达：每个操作都产出「替换 [replaceStart, replaceEnd) 为 replacement + 新选区」，UI 据此既能直改值、也能走原生插入通道 | `FormatResult` |
| 渲染支持：`==高亮==` → `<mark>` | `markdown.ts` 里 `md.use(mark)`（`markdown-it-mark@4`，`mark` 本就在清洗白名单里）；类型补充见 `web/src/types/markdown-it-mark.d.ts` |
| UI：编辑区上方 `.format-bar`，按 inline/heading/block/insert 分组、组间细竖线，`⋯ 更多` 收纳 `inline-code` 与 `hr`，右侧独立一组撤销/重做；预览视图下隐藏 | `App.svelte`（`#format-bar` / `#fmt-<id>` / `#fmt-more` / `#fmt-undo` / `#fmt-redo`）、`app.css` |
| 交互：选中文字→包裹；未选中→插入模板并定位光标；再点一次取消；按钮 `onmousedown` 阻止默认以保住 textarea 选区 | `App.svelte` 的 `applyFormatAction` / `replaceEditorRange` |
| 撤销/重做：按钮与 `Ctrl+Z`/`Ctrl+Y` 共用浏览器**原生撤销栈**（格式编辑经 `execCommand('insertText')` 落地，因此可被原生撤销） | `editorUndo` / `editorRedo` |
| 快捷键：`format-bold`(Ctrl+B)、`format-italic`(Ctrl+I) 进设置目录，可在设置里改键 | `web/src/lib/settings/catalog.ts` |
| 测试 | `tests/core.md-format.test.mjs`（38 项）、`tests/core.markdown.test.mjs` 新增 6 项高亮渲染 |
| 冒烟断言 | 主窗口 15 项：工具栏渲染/按钮齐全 → 加粗逐字比对 → 撤销 → 重做 → 高亮逐字比对 → `<mark>` 渲染 → H1 行首前缀逐字比对（防“插入而非替换”） → 再次点击还原 → 取消高亮 → 折叠区展开/收起 → 预览下隐藏与恢复（共 98 项） |

**本轮抓到并修掉的一个真实缺陷**（值得记住）：
`execCommand('insertText')` 是**在光标处插入**、并不删除选区。最初我算了 `replaceStart/replaceEnd` 却**没有在调用前把选区设成这个区间**，
于是行首前缀类操作（H1/列表）把整行又拼了一遍——值变成 `# ==内容==...==内容==...` 这种重复串。
更糟的是我最初的断言只查 `startsWith('# ')`，**恰好能通过**，所以差点漏掉。
现在两处都修了：① 调用前 `setSelectionRange(res.replaceStart, res.replaceEnd)`；
② 调用后用 `ta.value === res.text` 校验，不一致就走回退路径纠正；
③ 冒烟断言改为**逐字比对**（`value === 期望完整字符串`），这类“只在局部看起来对”的缺陷再也过不去。

设计取舍：
- **不做富文本（WYSIWYG）**：会破坏“一条笔记一个纯文本 `.md`、任何编辑器都能打开”的根本优点，且牵动搜索/待办回写/回收站一整串既有能力。
- **不做字体颜色**：Markdown 无标准语法，只能用内联 HTML，而现有安全清洗会剥掉内联样式；改用 `==高亮==`（背景色标记）满足“突出显示”的需求。
- 同字符标记的“已生效”判定：单字符标记（`*` 斜体、`` ` ``）当连续字符数为**奇数**时才算生效；多字符（`**`、`~~`、`==`）连续数 ≥ 标记长度即算。
  这样在 `**粗**` 上点斜体会补成 `***粗***`（保留粗体），而 `***x***` 上点粗体会去掉粗体留斜体。
- 行首前缀归属按**最长匹配**：`- [ ] x` 算待办而不是无序列表，所以「待办 ↔ 列表」互转能正确整段替换前缀。

### 1.10 布局修复：宽度分配 / 不留白 / 可拖拽分隔条（本轮新增）

> 起因：用户反馈「放大后仍然出现空白地方，编辑/分屏/预览那一列不能随意控制大小，显得笔记很窄，滚动条仍然在中间」。
> 用 CDP 量了真实宽度后确认是**三个独立缺陷**（视口固定 1600px 时的实测值）：

| 模式 | 窗口 | app-shell | 编辑区 | workspace | 编辑器 | 预览 |
|---|---|---|---|---|---|---|
| 分屏（修复前） | 1600 | **1220** | 680 | 680 | **340** | **340** |
| 仅预览（修复前） | 1600 | **1220** | 680 | 680 | — | **340** ← 只占一半 |
| 仅编辑（修复前） | 1600 | **1220** | 680 | 680 | **340** ← 只占一半 | — |

| 缺陷 | 根因 | 修法 |
|---|---|---|
| ① 仅预览/仅编辑时内容只占一半、滚动条落在中间 | `.workspace > .editor/.preview { width: 50% }` 是给分屏写的，但只渲染一个子元素时它**仍然只拿 50%** | 改用下文的 flex-grow 分配 + `:only-child` 兜底 |
| ② 窗口放大/最大化后右侧留白 | `.app-shell { width: max-content }` 把内容宽度钉死在 224+8+300+8+680 = 1220px | `.app-shell` 改 `width: 100%`；`.editor-pane.open` 改 `flex: 1 1 680px`（`min-width: 360px`）让编辑区吸收多余空间 |
| ③ 面板宽度完全固定、无法调整 | 两条 seam 只能点击开合，`cursor: pointer`，宽度全是写死的常量 | 编辑⇄预览之间新增 `.split-handle` 分隔条，指针拖动改比例、双击恢复各半 |

**这里踩到一个很隐蔽的 CSS 规范细节（务必记住）**：
flex-grow 用比例分配时，**当所有 flex-grow 之和小于 1**，浏览器按「自己的 grow × 剩余空间」分配，
**余量留在原处不分配**（不是归一化到 100%）。所以 `flex: 0.5 1 0` 单独一个子元素只能拿到一半宽度——
实测 552/1060。分屏时 0.5+0.5=1 恰好正常，所以只有「仅编辑/仅预览」会露馅。
修法是显式兜底：

```css
.workspace > .editor  { flex: var(--split-left, 0.5) 1 0; min-width: 0; }
.workspace > .preview { flex: var(--split-right, 0.5) 1 0; min-width: 0; }
.workspace > .editor:only-child,
.workspace > .preview:only-child { flex-grow: 1; }
```

| 事项 | 实现位置 |
|---|---|
| 比例状态 + 拖拽 + 持久化（停手 400ms 写盘，避免拖动刷爆设置文件） | `App.svelte` 的 `splitRatio` / `onSplitPointerDown/Move/Up` / `resetSplitRatio` / `scheduleSplitSave` |
| 比例作为 CSS 变量注入 workspace | `<div class="workspace" style="--split-left: {splitRatio}; --split-right: {1 - splitRatio}">` |
| 设置项 `editor.splitRatio`（0.2–0.8，默认 0.5）——用 `clampFloat` 而不是 `clampNum`，**比例不能被四舍五入成整数** | `settings/types.ts`（`SPLIT_RATIO_RANGE`）、`settings/coerce.ts` |
| 窗口宽度策略调整：编辑区关闭时精确贴合内容；编辑区打开时**只放大不缩小**（已更宽就交给编辑区吸收） | `App.svelte` 的 `applyWindowWidth`（用 `innerSize()/scaleFactor()` 算当前逻辑宽度） |
| 跨窗口同步：设置变更时跟随比例，但**正在拖动时以本地为准**（避免手抖） | `subscribeSettings` 回调 |
| 测试 | `tests/core.settings.test.mjs` 新增 1 项（比例钳制/不取整/非法回退） |
| 冒烟断言 | 主窗口 10 项：分屏各半 → 分隔条存在 → 仅预览占满 → 仅编辑占满 → 拖动改比例 → 比例持久化 → 双击恢复各半 → 填满窗口不留白 → 图3 两个面板宽度为 0 → 侧栏宽度≈224（共 107 项） |

顺带修正的既有断言：原来「收回后内容宽度≈侧栏」断言 `.app-shell` < 260，
它依赖的是“shell 缩到内容宽”这个旧行为；现在 shell 填满窗口、**窗口缩放由桌面端 `setSize` 负责**，
所以改成断言“列表/编辑区宽度为 0 且侧栏≈224”（Web 预览下浏览器窗口本来就不能被页面缩放）。

### 1.11 回车即换行（hardBreaks，默认开启）（本轮新增）

> 起因：用户反馈「为什么我按回车右边没有换行」——一行一个词（单词表）写下去，预览里却被拼成一句。
> 这是 Markdown 的规定（单个换行 = 段内软换行，HTML 里退化成空格），但对“不想学 Markdown”的用户
> 是纯粹的坑：要换行得懂三种潜规则（行尾两个空格 / 空行 / 写成列表）。

| 事项 | 实现位置 |
|---|---|
| 渲染开关：`renderMarkdown(text, { hardBreaks })`，用**两个缓存的渲染器实例**（true/false）而不是每次重建；默认 true | `markdown.ts` 的 `createRenderer(hardBreaks)` + `mdInstances` Map + `RenderOptions` |
| 设置项 `editor.hardBreaks`（默认 **true**）；非法值回退默认而不是当成 false | `settings/types.ts`、`settings/coerce.ts`（`pickBool`） |
| 设置页 UI：编辑器 → **「回车即换行」** 复选框（`#hard-breaks`），提示里写清开/关的区别 | `Settings.svelte` |
| 主窗口接线：`renderMarkdown(current.body, { hardBreaks: settings.editor.hardBreaks })`，直接读 state 保证响应式 | `App.svelte` 的 `previewRender` |
| 测试 | `tests/core.markdown.test.mjs` 新增 7 项（默认出 `<br>` / 显式 true 等价 / false 折叠成空格 / 空行分段两种模式都生效 / 标题·列表·引用·代码块不受影响 / 两个实例互不污染 / 待办 data-offset 不受影响）、`tests/core.settings.test.mjs` 新增 1 项 |
| 冒烟断言 | 主窗口 1 项：改正文为两行 → 预览出现 `甲<br>乙`（再还原正文）；设置窗口 4 项：开关存在 / 默认开启 / 关掉写入 `hardBreaks:false` / 再打开恢复（共 108 + 29） |

行为对照（实测）：

| 源码 | hardBreaks 开（默认） | hardBreaks 关 |
|---|---|---|
| `甲\n乙\n丙` | `<p>甲<br>乙<br>丙</p>` | `<p>甲\n乙\n丙</p>`（渲染成一句，空格分隔） |
| `甲\n\n乙` | 两个 `<p>` | 两个 `<p>`（空行分段不受影响） |

**顺手修掉一类不稳定断言（设置窗口冒烟）**：原来用 `localStorage.getItem(...).includes('"dark"')` 这种
**原始字符串匹配**判断“设置已写盘”，实测偶发失败（写盘是 300ms 去抖，字符串匹配只看某一瞬间，
字段顺序/转义也会影响）。现在统一走 `settingsEq('general.theme', 'dark')`——解析 JSON 后按键路径取值再
严格比较，并把超时放宽到 15s。改完连跑两次都是 29/29。

### 1.12 桌面壳与构建

- Rust 薄壳：`list/read/write/remove_note_file`、`read/write/remove_meta`、`read/write_settings`、`get_storage_info`、`open_path`、`pick_folder`、`migrate_notes`
- 权限、双窗口配置、应用图标（`src-tauri/icons/`）
- `scripts/setup.ps1`：ASCII 化（避免 PowerShell 5.1 编码问题）、自动结束运行中的 `noteapp.exe`（避免 exe 被占用）、`--no-bundle` 默认产出可运行 exe
- README 全量说明；`demo/` 保留为原型（另有一次提交 `a1cba63` 把它升级成文件夹+笔记双实体 + IndexedDB，并带自己的测试）

### 1.13 验证现状（本沙箱；主题落地前的历史基线）

- 单元/集成测试：102 项全绿（`npm test`）
- 真实 Chrome 冒烟：主窗口 51/51、设置窗口 14/14
- `tsc --noEmit` 通过；`vite build` 通过（双页产物）
- 覆盖点：frontmatter 往返、回收站全流程、手排/文件夹排序、搜索转义、Markdown/XSS、动作注册表、设置归一化/冲突/未知字段、存储字段契约、QQ 吸附纯计算、UI 面板宽度断言

### 1.14 验证现状（本沙箱，当前）

- **单元/集成测试：195 项全绿**（`npm test`；102 → 116（主题）→ 120（实时跟随）→ 129（标签/置顶）→ 142（待办聚合）→ 186（格式工具栏）→ 187（分屏比例）→ 195（回车即换行））
- **真实 Chrome 冒烟：主窗口 108/108、设置窗口 29/29**（本轮新增：换行 1 + 3，另加设置开关 1）
- `tsc --noEmit` 通过；`vite build` 通过（双页产物，含 head 内联主题引导脚本）
- 环境提示：本沙箱里 `vite build` 与 headless Chrome 都必须以 `danger-full-access` 升级执行（esbuild spawn / Chrome mojo 命名管道）；冒烟脚本要放到后台作业里跑，避免前台超时被中断导致误判；**CDP 实例跑几轮后要换端口重启**（标签页累积会导致 WS 异常，表现为脚本挂住或 `Inspected target navigated or closed`），且 `$env:TEMP` 每次调用都不同、不要用它做跨调用临时文件路径
- **别在断言里匹配 localStorage 原始字符串**（见 §1.11 末段）：用 `settingsEq('a.b', value)` 解析后比较

---

## 2. 待你在本机确认（未验证 / 未确认）

> 这些改动本沙箱都无法验证（要么是 Rust，要么是原生窗口交互）。请 `npm run desktop:setup` 后按顺序确认：

1. **最新提交 `dfbf888`**：存储页的“当前笔记目录”不再显示 `\\?\` 前缀；若指针指向默认目录，界面显示“未自定义”且冗余 `storage.json` 被清理。
2. **`rfd` 原生目录选择**（`128f7d5` 引入）：`cargo` 是否能成功拉取 `rfd = "0.15"` 并编译；「浏览…」是否弹出系统选择文件夹对话框。
3. **迁移完整流程**：选一个空目录 → 验证并迁移 → 提示成功、三个路径刷新、重启应用后仍是新目录、原目录文件保留。
4. **侧边吸附手感**（最近改动未确认）：拖到屏幕左/右越界即吸、垂直居中、置顶；鼠标移开 3 秒平滑滑出；光标贴近屏幕边缘滑回。若与系统“半屏贴靠”仍打架或手感不对，记录现象（越界多少才吸？滑出快慢？热区宽窄？）再调 `side-dock.ts` 顶部常量。
5. 顺带确认上一轮已修的：快捷键点“默认”不再回弹；设置窗口关闭后能再次打开。
6. **主题**（前端改动，本沙箱已用真实 Chrome 验证逻辑与配色变量，但**桌面端观感需你本机确认**）：
   - 设置 → 通用 → 主题：切「深色」应立即变暗，**主窗口与设置窗口同时变**；
   - 重启应用后仍是深色（`settings.json` 持久化）；
   - 切「跟随系统」后：**直接在 Windows 设置里切换应用/系统主题，两个窗口应立即跟随**（无需重开窗口）；再切到固定「浅色」后，系统主题变化不应再影响应用；
   - 首屏不闪白：深色下重启，启动那一瞬不应出现刺眼白底；
   - 细看深色下的**预览排版与浮层**：代码块固定深底、表格/引用/待办删除线是否可读；确认/重命名弹窗底色与边框是否清晰（本机看深色下弹窗边框与遮挡是否舒服）；有不对的请截图或说明位置。
7. **本轮标签与置顶**（前端，本沙箱已用真实 Chrome 验证交互与落盘，但**桌面端观感需你本机确认**）：
   - 打开一篇笔记 → 编辑区「标签」一行输入 `工作` 回车 → 标签出现在笔记行与标签条；点标签条按标签筛选，点「清除标签」退出；
   - 编辑区「📌 置顶」→ 该笔记跳到列表最前并带 📌；**重启后仍在最前**；再点「已置顶」取消；
   - 行右键应有「置顶 / 取消置顶」；多选后操作条有「置顶 / 取消置顶」；
   - 标签与置顶都写在 `.md` 的 frontmatter（`tags: [...]` / `pinned: true`），用记事本/其它编辑器打开应能看到；
   - 置顶笔记**不能**被拖到非置顶区（会被拦并提示），这是有意设计。
8. **待办聚合**（前端，本沙箱已用真实 Chrome 验证交互与回写，但**桌面端观感需你本机确认**）：
   - 侧栏「☑️ 待办」→ 应汇总全库未完成任务（未完成在前，角标为未完成数）；
   - 勾选某条 → 该条从未完成清单消失，**打开对应笔记能看到源文已变成 `- [x]`**；
   - 点任务文本 → 跳回原笔记、编辑区滚动到该行附近并短暂高亮（1.8s）；
   - 「显示已完成」→ 已完成项带删除线显示；
   - 若某篇笔记任务很多，确认跳转后的滚动位置是否够准（文本框只能按行号比例估算）。
9. **本轮格式工具栏**（前端，本沙箱已用真实 Chrome 逐字校验，但**桌面端观感与手感需你本机确认**）：
   - 打开任意笔记，编辑区上方应出现一排按钮（B / I / S / 高亮 / H1 H2 H3 / • 1. ☑ ❝ </> / 🔗 ▦ / ⋯ / ↶ ↷）；
   - **选中一段文字点 B** → 文字两边出现 `**`，预览里变粗；再点一次 B → 恢复；
   - **点「高亮」** → 预览里该段文字有黄底（这就是你要的“换色”效果）；
   - **点「</>」代码块** → 插入一对围栏、光标在中间；**点「▦」表格** → 插入一张空表；
   - **点「⋯」** → 展开行内代码与分隔线；点空白处应收起；
   - **撤销/重做按钮**与 `Ctrl+Z` / `Ctrl+Y` 应该是同一套（用按钮改了格式后按 Ctrl+Z 也能回退）；
   - 切到「预览」视图时工具栏会隐藏（只读），切回「编辑/分屏」回来；
   - 若某个按钮在你的使用习惯下应该换个位置或名字，直接说，改名/换位是纯前端小改动。
11. **本轮布局修复**（前端，本沙箱已用真实宽度测量 + 冒烟断言验证，但**桌面端的窗口缩放手感需你本机确认**）：
   - **把窗口拉大**：编辑区应跟着变宽、右侧不留空白（原来是固定 1220px，放大后右边一片空）；
   - **切到「预览」**：正文应占满整个编辑区，滚动条贴在编辑区右边缘（原来只占一半、滚动条卡在中间）——这是你截图里那个问题；
   - **切到「编辑」**：同上，输入框占满；
   - **分屏时拖动中间那条分隔条**：编辑/预览比例应随手改变；**双击**它恢复各半；拖动后重启应用比例应保持；
   - **窗口已经拉大时点开/收起面板**：不应把窗口突然缩回 1220px（只有编辑区关闭时才会贴合内容收缩）；
   - 如果觉得“图3 时窗口仍会收缩成窄条”不合适，或者希望侧栏/列表也能拖动改宽，直接说。
12. **本轮回车即换行**（前端，本沙箱已用真实渲染 + 冒烟验证，但**你本机要确认的就是你最初那个场景**）：
   - 打开你那篇「英语词汇」笔记：**一行一个词在预览里应该各占一行**（不再是拼成一句）；
   - 设置 → 编辑器 → 「回车即换行」：**关掉后**预览应恢复成"几行拼成一句"的严格 Markdown 行为，**打开**则又分行；
   - 空行分段、标题、列表、引用、代码块的开/关表现应完全一致；
   - 如果你希望默认就是关（严格模式），或者想要“只对列表生效”之类的细分，直接说。
13. **发布确认**：按 §8 推送并创建 Release（`v0.1.0`，说明中已注明“不含快速便签/悬浮窗”），确认 Release 里能看到 `NoteApp.exe`（用 Actions 构建则还有 MSI/NSIS）。

---

## 3. 未实现（功能待办）

### 3.1 P1（ROADMAP 里明确列出的，尚未做）

| 功能 | 备注 |
|---|---|
| ~~主题（浅色/深色/跟随系统）~~ | **已完成**，见 §1.6 |
| ~~标签系统 / 笔记置顶（pin）~~ | **已完成**，见 §1.7 |
| ~~待办聚合视图（汇总所有未完成）~~ | **已完成**，见 §1.8 |
| ~~格式工具栏（Markdown 语法可视化）~~ | **已完成**，见 §1.9（不在原 ROADMAP 里，来自用户“不会用 Markdown”的反馈） |
| ~~布局：宽度分配 / 不留白 / 可拖拽分隔条~~ | **已完成**，见 §1.10（用户截图反馈） |
| ~~回车即换行（hardBreaks）~~ | **已完成**，见 §1.11（用户反馈“按回车右边没换行”） |
| 多级目录 | 目前一级（子文件夹） |
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
- **Svelte 5 响应式坑（已踩过两次，务必记住）**：`$derived` 不会追踪「被它调用的函数内部」读取的 state。凡是要随数据变化的派生值，必须在 `$derived` 表达式里**直接读** state（如 `listItems`），或改由 `refresh()` 显式写入 state（如 `allTags`）。写成 `someFn(core.xxx())` 只会算一次并永久停留在首次结果。
- **`execCommand('insertText')` 的坑（见 §1.9）**：它是“在光标处插入”，**不会**替你删除选区。要用它替换一段区间，必须先 `setSelectionRange(replaceStart, replaceEnd)`，并在调用后用 `textarea.value === 期望文本` 校验结果。同理，写断言时不要只用 `startsWith`/`includes`——用**逐字比对**才能拦住“局部看起来对”的缺陷。
- **flex-grow 之和 < 1 的坑（见 §1.10）**：flex 分配剩余空间时，若所有 flex-grow 之和**小于 1**，浏览器按「各自的 grow × 剩余空间」分配，余量**留在原处**（不归一化）。`flex: 0.5 1 0` 单独一个子元素只能拿到一半宽度。所以“单个子元素占满”要么让 grow 和为 1，要么显式 `:only-child { flex-grow: 1 }`。
- **断言里的“按位置取元素”很脆**：`document.querySelector('.settings-body select')` 这类“第一个下拉/第一个按钮”的定位，在页面上插入新行后就会指到别的元素（§1.10 与主题那轮都踩过）。新写断言请按 **id 或语义标签** 定位。
- **断言里的“匹配原始字符串”也很脆**：判断设置是否写盘不要用 `raw.includes('"dark"')`，写盘是去抖的、字符串还受字段顺序/转义影响，实测偶发失败。统一用 `settingsEq(路径, 期望值)` 解析 JSON 后严格比较（见 §1.11）。
- `App.svelte` 里保留了一个 Web 预览专用的诊断钩子 `window.__diag()`（仅 `!isTauri()` 时挂载），用于排障与冒烟定位；如果觉得碍事可以删。

---

## 4. 下一个对话的指示（直接照着做）

### Step 0：恢复上下文
1. `git status` 确认干净；`git log --oneline -5` 确认 HEAD（本次交接提交后以 `git log -1` 为准；此前为 `518875e`）。
2. 读 `docs/PROGRESS.md`（本文件）→ `AGENTS.md` → `README.md`。
3. 跑一遍基线：`node --test --test-isolation=none "tests/**/*.test.mjs"`（应 195 通过）。

### Step 1：先收口“待确认项”
- 让用户执行 `npm run desktop:setup`，按 §2 的 1–13 条逐项确认（含主题观感、标签与置顶、待办聚合、格式工具栏、布局与拖拽分隔条、回车即换行）。
- 有报错就修；Rust 报错优先看 `src-tauri/src/fs_store.rs` 与实际 cargo 输出。

### Step 2：按优先级做新功能（每次一项，走完整闭环）
建议顺序（先易后难、先低风险）：
1. **启动校验 + 迁移前 zip 备份**（§3.2）：Rust 加 `validate_storage`/`backup_notes` 命令，设置页给开关；补单测（纯逻辑）+ 更新 README。
2. **命令面板 + 全局热键**：动作注册表扩展，Tauri `global-shortcut` 插件 + 设置页热键页签；冲突检测复用 `findShortcutConflict`。
3. **悬浮速记/快搜窗**：以设置窗口为样板加第三窗口 + tray（`tauri-plugin-*` 需新增依赖，注意让用户本机构建验证）。
4. **多级目录 / 导出 HTML / 字数统计扩展 / 回收站自动清理** 等按需推进（§3.1 剩余项）。
5. 主题与标签的后续小项（可选）：代码块主题跟随、高对比档；标签重命名/批量管理、标签出现在搜索结果里、按标签统计面板；待办聚合的“按文件夹/标签分组”“已办保留期”。
6. 格式工具栏的后续小项（可选）：字号/对齐类（Markdown 无标准语法，需评估）、插入图片（等附件功能）、把常用按钮做成可自定义排序、给按钮加“当前是否生效”的高亮态（需按光标位置反查语法）。

### Step 3：每项改动的固定动作（AGENTS.md 要求）
1. 先写/改测试（core 纯逻辑放 `tests/core.*.test.mjs`；设置相关放 `tests/core.settings.test.mjs`/`core.storage-info.test.mjs`）。
2. 跑：`node --test --test-isolation=none "tests/**/*.test.mjs"` + `npm --prefix web run typecheck`（都应为 0）。
3. 若动前端：`npm --prefix web run build`（需 `danger-full-access` 升级）→ 起 `serve-dist.mjs` + headless Chrome（也需升级；建议换个端口如 `--remote-debugging-port=9244`）→ **把两个冒烟放到后台作业里跑**（前台容易被超时中断而误判失败）→ 必要时给冒烟**加断言**再跑。
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
| 主题 | `web/src/lib/desktop/theme.ts`（解析/应用/首屏引导）、`web/src/main/app.css` 顶部两档变量、`web/index.html`+`web/settings.html` 内联引导、`tests/theme.css.test.mjs`（样式契约） |
| 标签 / 置顶 | `web/src/lib/core/tags.ts`（纯逻辑+单测）、`store.ts` 的 `sortPinnedFirst`/`applyManualOrder`、`App.svelte` 的 `#tagbar`/`#tag-editor`/`#pin-toggle`、`tests/core.tags-pin.test.mjs` |
| 待办聚合 | `web/src/lib/core/todos.ts`（行扫描+汇总+过滤，纯逻辑+单测）、`App.svelte` 的 `.todo-row`/`todoItems`/`openTodoSource`/`toggleShowDoneTodos`、`tests/core.todos.test.mjs` |
| 格式工具栏 | `web/src/lib/core/md-format.ts`（纯逻辑 + `FORMAT_BUTTONS` 目录，单测 `tests/core.md-format.test.mjs`）、`App.svelte` 的 `#format-bar`/`applyFormatAction`/`replaceEditorRange`/`editorUndo`、`app.css` 的 `.format-bar` 段、高亮渲染在 `markdown.ts`（`md.use(mark)`） |
| 面板宽度 / 分屏比例 | `App.svelte` 的 `splitRatio`/`onSplitPointer*`/`applyWindowWidth`/`computeWidth`、`app.css` 的 `.app-shell`/`.editor-pane.open`/`.workspace > *`/`.split-handle`、设置项 `editor.splitRatio`（`settings/types.ts` + `coerce.ts` 的 `clampFloat`） |
| 换行（回车即换行） | `markdown.ts` 的 `createRenderer(hardBreaks)`/`renderer()` 缓存/`RenderOptions`、设置项 `editor.hardBreaks`、`Settings.svelte` 的 `#hard-breaks` 复选框、`App.svelte` 的 `previewRender` 传参 |
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
- 主题：**三档（浅色 / 深色 / 跟随系统），默认浅色**；「跟随系统」实时跟随系统主题变化（只在 system 档订阅）
- 格式工具栏：**不做富文本所见即所得**（会破坏“纯文本 .md”的根基）、**不做字体颜色**（Markdown 无标准语法，改用 `==高亮==` 背景标记）；只做“点按钮替你打符号”
- 布局宽度：**编辑区吸收多余空间**（窗口放大后编辑区变宽、不留白）；**编辑⇄预览可分屏比例可拖动并持久化**（`editor.splitRatio`，20%–80%，双击恢复各半）；窗口只在“比目标窄”时放大，已更宽就不动（避免最大化状态下点开面板被打回原宽度）
- 换行：**默认「回车即换行」**（`editor.hardBreaks: true`，即 GFM `breaks`）——面向不想学 Markdown 的用户，一行一条记录时回车就该分行；可在设置里关掉改用严格 CommonMark

---

## 7. 复现验证的最短命令

```powershell
# 单测（195）
node --test --test-isolation=none "tests/**/*.test.mjs"

# 类型检查
npm --prefix web run typecheck

# 构建（需 danger-full-access 升级：esbuild 要 spawn）
npm --prefix web run build

# Web 冒烟（两个窗口；Chrome 同样需 danger-full-access 升级，且建议换端口避免旧实例干扰）
node web/scripts/serve-dist.mjs 5190                 # 终端 A：5190
chrome --headless=new --user-data-dir=%TEMP%\na-smoke --remote-debugging-port=9371 about:blank   # 终端 B
$env:CDP_PORT='9371'; $env:SMOKE_URL='http://127.0.0.1:5190/'; node web/scripts/ui-smoke.mjs        # 108 项
$env:CDP_PORT='9371'; $env:SMOKE_URL='http://127.0.0.1:5190/'; node web/scripts/settings-smoke.mjs  # 29 项

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
