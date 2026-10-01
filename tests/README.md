# 测试套件约定

本目录用 `node:test` 运行（根目录 `npm test`，glob 为 `tests/**/*.test.mjs`）。

**文件名必须体现它覆盖哪一层** —— 否则很难判断"改这里会不会影响生产代码"，而这一点在
本次规范检查前是含糊的：`markdown.test.mjs` / `store.test.mjs` 看名字像生产测试，
实际测的是 `demo/` 里的浏览器原型。

| 前缀 | 覆盖对象 | 例子 |
| --- | --- | --- |
| `core.*` | 生产逻辑：`web/src/lib/**`、`web/src/shared/**` | `core.store.test.mjs`、`core.tags-pin.test.mjs`、`core.theme.test.mjs` |
| `demo.*` | `demo/` 浏览器原型（P0 时期的参照实现，去留见 `docs/TECH_DESIGN.md`） | `demo.markdown.test.mjs`、`demo.store.test.mjs`、`demo.ui-regression.test.mjs` |
| `<产物>.*` | 产物级契约：直接读生产文件做断言，不 import 模块 | `theme.css.test.mjs`（读 `web/src/main/app.css` 与两个 HTML 入口）、`scripts.build-guard.test.mjs`（仓库与工具链不变量） |

约定由 `scripts.build-guard.test.mjs` 的「测试命名规范」用例**强制**：

- 凡内容涉及 `demo/` 的测试文件必须以 `demo.` 开头；
- 凡内容涉及 `web/src/` 的测试文件必须以 `core.` 开头，或登记进产物级白名单
  （白名单要写明理由，避免"随手加个例外"）。

## 为什么 `demo.*` 与 `core.*` 有相近用例还要都保留

它们的标题相似（例如 markdown 的转义/高亮/任务列表偏移），但**测的是两个不同实现**：

- `demo/js/markdown.mjs` —— P0 时期手写的原型解析器；
- `web/src/lib/core/markdown.ts` —— 现在的 markdown-it + GFM + 清洗的生产实现。

两者都保留是刻意的回归基线（`docs/TECH_DESIGN.md` 明确把 demo 作为迁移验收参照），
**不是重复劳动**；改名就是为了让"哪一层"一眼可见、避免以后误删或误改。

## 验证入口

```powershell
npm test                          # 全部单测
npm run verify                    # 单测 + 类型检查 + 前端格式 + rustfmt + clippy（提交前跑这个）
npm run smoke / smoke:settings    # 真实 Chrome 端到端冒烟（需先 npm run serve:dist）
```
