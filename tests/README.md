# 测试套件约定

本目录用 `node:test` 运行（根目录 `npm test`，glob 为 `tests/**/*.test.mjs`）。

**文件名必须体现它覆盖哪一层** —— 否则很难判断"改这里会不会影响生产代码"。
这条规矩是 2026-10-01 规范检查时补上的：当时 `markdown.test.mjs` / `store.test.mjs` 看名字像
生产测试，实际测的是 `demo/` 里的浏览器原型。

| 前缀 | 覆盖对象 | 例子 |
| --- | --- | --- |
| `core.*` | 生产逻辑：`web/src/lib/**`、`web/src/shared/**` | `core.store.test.mjs`、`core.tags-pin.test.mjs`、`core.theme.test.mjs` |
| `<产物>.*` | 产物级契约：直接读生产文件做断言，不 import 模块 | `theme.css.test.mjs`（读 `web/src/main/app.css` 与两个 HTML 入口）、`scripts.build-guard.test.mjs`（仓库与工具链不变量） |

约定由 `scripts.build-guard.test.mjs` 的「测试命名规范」用例**强制**：

- 凡 import/读取 `web/src/` 的测试文件必须以 `core.` 开头，或登记进产物级白名单
  （白名单要写明理由，避免"随手加个例外"）；
- 规则里仍保留 `demo.` 分支：**若将来再引入原型/参照实现层，命名必须带 `demo.` 前缀**
  （旧的原型层 `demo/` 及其 4 个测试已于 2026-10-01 删除，P0 参照使命完成）。

## 验证入口

```powershell
npm test                          # 全部单测
npm run verify                    # 单测 + 类型检查 + 前端格式 + rustfmt + clippy（提交前跑这个）
npm run smoke / smoke:settings    # 真实 Chrome 端到端冒烟（需先 npm run serve:dist）
```
