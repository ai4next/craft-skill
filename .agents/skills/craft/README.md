<div align="center">

# craft.skill

> 交互式可视化生成专家。把数据、概念或参数模型变成一个自包含 HTML —— 双击即开，断网可用，明暗主题自动跟随系统，键盘完全可达。

</div>

## 它能做什么？

| 类型 | 场景 |
|------|------|
| `chart` | 数据图表、多图看板、KPI、对比图 |
| `explainer` | 可探索解释：分步叙事 + 参数控件 + 联动视图 |
| `diagram` | 技术图解，六个子类型：`architecture` / `workflow` / `sequence` / `dataflow` / `lifecycle` / `freeform` |
| `simulation` | 参数驱动沙盘：模型随参数演化 |

**不适用**：纯静态图片（海报、封面、插画）。

## 图解：只写拓扑，不写坐标

技术图解的几何**全部由运行时自动算** —— 分层、排序、坐标、正交路由、端口分配、标签避让、分组框。

```json
{ "kind": "architecture",
  "nodes": [
    { "id": "gateway", "label": "API 网关", "kind": "frontend" },
    { "id": "order",   "label": "订单服务", "kind": "backend", "group": "core" },
    { "id": "pg",      "label": "PostgreSQL", "kind": "database", "group": "core" } ],
  "edges": [
    { "from": "gateway", "to": "order" },
    { "from": "order", "to": "pg", "label": "读写" } ] }
```

没有 `pos`、没有 `size`、没有 `route`。11 个组件的架构图，作者只写约 20 行拓扑。

**为什么这很重要**：要求作者手写坐标的工具，得再用一堆校验器去检查那些坐标有没有重叠、有没有压住别的元素。
craft 让坏几何**不可能产生** —— 而且因为布局引擎是 DOM-free 的，`check.mjs` 能在 Node 里跑同一份引擎，
把「几何对不对」从「截图碰运气」变成 `exit 1` 加精确行号。

### 读者交互也全部现成

搜索（`/`）、点节点看上下游、路径探查、缩放平移 + 细节层级、导览章节、演示模式（`f`）、
缩略图、导出 PNG/SVG、深链（`#focus=` / `#route=` / `#view=`）—— 都不用写一行代码。

## 它和别的图表工具有什么不同？

常见做法是每次从零手写 HTML/CSS/JS，于是反复踩同一批坑：比例尺算错、窗口一缩放图形重影、暗色主题下颜色不可读、引了 CDN 导致产物离线打不开。

craft 把**易错且重复**的部分固化成运行时，把**因内容而异**的部分留给模型：

| 运行时负责 | 模型负责 |
|---|---|
| 比例尺、坐标轴、刻度粒度（含跨时区的时间轴） | 选什么图、讲什么故事 |
| resize 重绘、主题切换重绘（`ctx.join` 保证不重影） | 图形怎么摆 |
| tooltip、键盘可达性、屏幕阅读器数据表 | 标注写什么 |
| 明暗令牌、对比度、`prefers-reduced-motion` | 品牌色覆盖 |
| 确定性校验 + 机器可读修复回执 | 按回执修内容 |

**`chart` 类型一行 JS 都不用写** —— 用 `data-*` 属性声明，运行时自动挂载。

## 工作流

```
路由类型 → 读三份文档 → 写候选产物 → check 校验 → 加料再校验 → 冻结交付
```

产物硬约束：**单文件、零外链、离线可用**。体积 > 320KB 告警、> 400KB 报错 ——
运行时本身约 225KB，所以内联数据要留出余量（当前示例产物约 230KB）。

## 目录结构

```
craft-skill/
├── SKILL.md                      # 主技能定义（骨架、路由表、快速路径、反模式）
├── README.md                     # 本文件
├── REFERENCES.md                 # 参考文档索引
├── CLAUDE.md                     # Claude Code 上下文
├── .agents/skills/craft/         # agentskills.io 约定的镜像（勿手改，sync.mjs 生成）
├── .claude/skills/craft/         # Claude Code 约定的镜像（同上，两份内容一致）
├── assets/
│   └── template.html             # 外壳 + 设计令牌 + 完整 Craft 运行时（唯一长文件）
├── references/
│   ├── authoring-contract.md     # 槽位协议 + data-* 契约 + 硬约束 + 失败→修复表
│   ├── diagram-model.md          # 六个图解子类型的模型契约
│   ├── visualization-grammar.md  # 图表选型、坐标轴、颜色、常见的图表谎言
│   ├── explainer-craft.md        # 叙事结构、控件设计、模拟建模
│   ├── interaction-patterns.md   # 交互模式库、图解布局与关系语义
│   └── design-system.md          # 令牌体系与配色规范
├── scripts/
│   ├── check.mjs                 # 交付门禁：诊断规则 + Node 布局沙箱 + 几何断言
│   │                             #   规则权威清单见 references/authoring-contract.md 第六节
│   ├── mermaid.mjs               # Mermaid → craft 模型（flowchart / sequence / state）
│   ├── manifest.mjs              # 镜像清单与示例类型的唯一事实源
│   ├── sandbox.mjs               # 在 Node 里跑 DOM-free 的布局引擎
│   ├── sync.mjs                  # 重新生成镜像与示例产物
│   └── shot.mjs                  # 无头 Chrome 截图回执（无浏览器时跳过）
└── examples/                     # 每个示例都有 skeleton.html（四槽最小骨架）
    ├── chart/                    # 数据图表：两个图表、零行作者 JS
    ├── explainer/                # 可探索解释：五段叙事 + 渐进披露 + 联动控件
    ├── simulation/               # 参数驱动模拟：固定种子的确定性模型
    ├── diagram-architecture/     # 架构图：11 个组件、零坐标
    ├── diagram-sequence/         # 时序图：参与者 + 消息，不写 y
    ├── diagram-lifecycle/        # 状态机：相位带 + 事件 + 终态
    ├── diagram-dataflow/         # 数据管道：阶段列 + 血缘
    ├── diagram-workflow/         # 泳道流程：泳道 + 决策菱形
    └── diagram-freeform/         # 作者给坐标的自由图解（唯一有 pos 的子类型）
```

每个示例目录下：`slots/` 是源（手写），`index.html` 是生成物（勿手改），
`skeleton.html` 是该类型的最小骨架，`README.md` 说明它演示了什么。

SKILL.md 保持精简，详细内容按需加载 —— 它包含一张路由表，告诉模型在什么时机读哪个参考文件。

## 安装

```bash
npx skills add ai4next/craft-skill
```

## 用法

装好后直接说需求即可：

```
把这组数据做成可交互的图
做个能拖参数的讲解页，解释复利
把 Transformer 的注意力机制可视化出来
做个 SIR 传染病模型的沙盘
画个订单系统的架构图
把这条 API 调用链画成时序图
画个订单状态机
```

## 校验产物

```bash
node scripts/check.mjs <产物.html>          # 人读格式
node scripts/check.mjs <产物.html> --json   # 机器可读回执
node scripts/check.mjs <产物.html> --mirror # 附带检查镜像是否同步
```

退出码 `0` 零 error／`1` ≥1 error／`2` 用法或读取错误。**只读，从不自动修复。**

诊断带稳定的 `code` / `subject` / `evidence` / `supportedFixes`，模型可以按回执定向修复。

## 开发

```bash
node scripts/sync.mjs            # 改完模板或 slots 后重新生成派生文件
node scripts/sync.mjs --check    # 只检查是否同步
```

`check.mjs` 有一条 `artifact/runtime-stale` 规则：产物携带的运行时区块必须与当前
`assets/template.html` 逐字节一致。所以模板一改，所有示例立刻报错，不会被误当成有效证明。

## 许可

MIT
