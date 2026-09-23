# CLAUDE.md

给 Claude Code 的上下文提示。完整技能定义见 `SKILL.md`。

## 这个仓库是什么

`craft-skill` 是一个 agent 技能，教模型生成**交互式可视化**的自包含 HTML 产物。
它是 ai4next 技能家族的一员（同族：`gang-skill`、`distill-skill`、`idea-skill`、`summon-skill`）。

## 仓库结构要点

| 路径 | 说明 |
|---|---|
| `SKILL.md` | 技能的规范源。**改技能行为先改这里。** |
| `assets/template.html` | 外壳 + 设计令牌 + 完整 `Craft` 运行时（~5700 行）。**这是产品本体。** |
| `references/*.md` | 按需加载的长文档。六份，各有明确触发时机。 |
| `scripts/check.mjs` | 交付门禁。规则的权威定义在 `references/authoring-contract.md`，两边必须同步。 |
| `scripts/sync.mjs` | 重新生成派生文件（镜像 + 示例产物）。 |
| `scripts/mermaid.mjs` | Mermaid → craft 模型（flowchart / sequenceDiagram / stateDiagram）。 |
| `scripts/manifest.mjs` | 镜像清单与示例类型的唯一事实源，check/sync 共用。 |
| `scripts/sandbox.mjs` | 在 Node 里跑 DOM-free 的布局引擎，check 与 test 共用。 |
| `test/` | 测试套件（`node --test 'test/*.test.mjs'`）。 |
| `examples/<类型>/slots/` | 示例的源文件。`index.html` 是生成物，**勿手改**。 |
| `.agents/skills/craft/` | agentskills.io 约定的镜像。**勿手改** —— 跑 `node scripts/sync.mjs`。 |
| `.claude/skills/craft/` | Claude Code 约定的镜像，内容与上者相同。**同样勿手改**。 |

## 改动时的约束

1. **改了 `assets/template.html` 就必须跑 `node scripts/sync.mjs`** ——
   否则 `check.mjs` 的 `artifact/runtime-stale` 规则会让所有示例报错。这是有意的。
2. **改了 `check.mjs` 的规则就必须同步更新 `references/authoring-contract.md`** ——
   那份文档是契约，checker 只是契约的可执行形式。
3. **不要在根目录和镜像里各改一份。** 根目录是唯一源。镜像有**两处** ——
   `.agents/skills/craft/`（agentskills.io 约定）与 `.claude/skills/craft/`（Claude Code 约定），
   清单由 `scripts/manifest.mjs` 的 `MIRRORS` 定义，`node scripts/sync.mjs` 一起生成。
   只改一处会留下另一处漂移，`--mirror` 检查会报 `mirror/stale`。
4. **新增令牌要同时改三处**：`assets/template.html` 的两套主题块、
   运行时里的 `TOKEN_NAMES` 数组、`references/design-system.md` 的令牌表。
5. **布局引擎必须保持 DOM-free**。`Craft.measure` / `Craft.layout` / `Craft.route`
   不许调用 `getBBox`、`measureText` 或任何 DOM API ——
   `check.mjs` 的 `makeLayoutSandbox()` 会把这几块抽出来在 Node 里直接跑，
   对几何做机械断言。引入一个 DOM 依赖就会让整条几何验证链路失效。
6. **布局必须确定性**：所有排序的平局都要有稳定兜底（按 id 或作者给的 `order`），
   不能依赖对象键序或 `Math.random`。`layout/deterministic` 规则会跑两次比对。
7. **改了 `Craft.measure` 的字符宽度表**要重跑示例并看图 —— 框尺寸全靠它推。
8. **槽位填充一律用函数形式的 `String.replace` replacer**。字符串形式的替换串会把内容里的
   `$$` / `$&` / `` $` `` / `$'` / `$1` 当成替换模式解释，**静默改写作者代码**（`$$` 会变成 `$`）。
   `sync.mjs` 的 `fill()` 已带自检，填完会回验内容原样进了产物。

## 测试

```bash
node --test 'test/*.test.mjs'                      # 全部测试
node scripts/check.mjs examples/chart/index.html   # 示例必须 0 error
node scripts/sync.mjs --check                      # 派生文件必须已同步
node scripts/sync.mjs                              # 重新生成
```

五组测试：

| 文件 | 覆盖 |
|---|---|
| `golden.test.mjs` | 每个示例 0 error；`--mirror` 一致；派生文件已同步；每个示例都有 `skeleton.html` 且**组装后 0 error** |
| `diagnostics.test.mjs` | **反向夹具**：故意做坏的产物必须报出预期诊断码（含严重度与退出码） |
| `router.test.mjs` | 几何不变量：0 降级路由、0 遮挡标签、确定性、交叉规避确实有效、端口溢出 |
| `mermaid.test.mjs` | 三种 Mermaid 输入的结构断言 + **端到端**（生成的模型必须过 check） |
| `receipt.test.mjs` | 冻结回执、改动检测、拒绝给坏产物盖章 |

反向夹具是「现做现坏」：拿真示例按需变形，不把坏产物提交进仓库 ——
产物内嵌整个运行时，模板一改提交的坏产物就集体过期。

浏览器侧仍然靠人：
- 真实浏览器打开示例，确认渲染、主题切换、键盘导航
- **真的看截图** —— v1 正是靠这个抓到 4 个测试和校验都没发现的视觉 bug
- `shot.mjs` 会逐视口量浮层遮挡（工具条/缩略图 vs 节点框），这是静态检查看不见的一类缺陷

## 图解引擎的两条不变量

- 模型里**没有坐标**（`freeform` 除外）。几何全部由 `Craft.layout` + `Craft.route` 算出。
- 路由器的 `degradedRoutes` 计数是它自己承认失败的次数。示例必须为 0。

## 风格约定

- 文档中文优先，代码注释中文。
- 运行时不压缩、不构建 —— 产物保持可 grep。
- 零依赖：脚本只用 Node 内置模块，产物不引任何 CDN。
