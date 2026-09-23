---
name: craft
description: |
  交互式可视化生成专家。把数据、概念或参数模型变成单个自包含 HTML —— 内联 SVG/Canvas，零外链，离线可用，明暗双主题，键盘可达。覆盖四类：数据图表与看板（chart）、可探索解释（explainer）、交互式概念图解（diagram）、参数驱动模拟（simulation）。

  适用：用户说「做个可视化」「把这组数据画成图」「做个交互式图表」「做个能拖参数的讲解页」「把 XX 原理可视化」「做个交互式教程」「做个模拟/沙盘/计算器」「做个看板」「做个对比器」；说「画个架构图」「画微服务拓扑」「画个时序图/调用链」「画个状态机」「画数据血缘/ETL 管道」「画个流程图/泳道图」；贴了 CSV/JSON/表格要求出图；要求产物能离线打开、能分享、能嵌进文档。

  **图解的几何由运行时自动布局** —— 你只写拓扑（谁连谁、谁属于哪个分组），不写任何坐标。

  贴了 Mermaid（flowchart / sequenceDiagram / stateDiagram）要求转成可探索的图解。

不适用：纯静态图片（海报、封面、插画）——那是 canvas-design 的活。
license: MIT
metadata:
  version: "1.0"
  author: ai4next
---

# craft | 交互式可视化

**把「易错且重复」的部分固化进运行时，把「因内容而异」的部分留给你。**

产物是一个自包含 HTML：双击即开，断网可用，明暗主题自动跟随系统。

## 四条铁律

1. **产物优先** —— 读完参考文档后的下一个动作必须是写候选文件。不要用散文规划布局，不要先读运行时源码。
2. **不重复造轮子** —— 比例尺、坐标轴、resize、主题重绘、tooltip、键盘可达性，运行时全都提供了。图解的分层、坐标、正交路由、标签避让也一样。自己再写一遍就会出 bug。
3. **不编造数据** —— 没有真实数据时，图注必须显式标注「示意数据」。宁可少画，不可假画。
4. **不静默覆盖** —— 写产物前若目标文件已存在且不是本次生成的，先确认再写。
   覆盖别人已有的文件是不可逆的；用户没要求时也不要在旁边堆临时文件。

## 参考文件路由

**按需读取。不要预先全读。**

| 时机 | 读取 |
|------|------|
| **总是**（写产物之前） | `references/authoring-contract.md` —— 槽位协议、`data-*` 契约、硬约束、验收清单、失败→修复表 |
| 做 `chart` / 看板 | `references/visualization-grammar.md` —— 数据→视觉编码选型、轴/图例/标注规范 |
| 做 `explainer` / `simulation` | `references/explainer-craft.md` —— 叙事结构、渐进披露、控件设计、状态↔视图联动 |
| 做 `diagram`（技术图解） | `references/diagram-model.md` —— 六个子类型的模型契约、字段表、示例 |
| 需要交互模式 | `references/interaction-patterns.md` —— 交互模式库 |
| 用户指定了品牌色/视觉风格 | `references/design-system.md` —— 令牌体系与配色规范 |

再加**一个**对应类型的 `examples/<类型>/skeleton.html`（小文件，~6KB）。

**第一个候选落地之前，不要读 `assets/template.html` 里的运行时源码。** 只有遇到无法解释的内部诊断、或两轮定向修复都失败时，才去翻实现。

---

## 类型路由

| 类型 | 用于 |
|------|------|
| `chart` | 数据图表、多图看板、KPI、对比图 |
| `explainer` | 可探索解释：分步叙事 + 参数控件 + 联动视图 |
| `diagram` | 技术图解，六个子类型见下 |
| `simulation` | 参数驱动沙盘：模型随参数演化 |

### `diagram` 的子类型

选定 `chart`/`explainer`/`diagram`/`simulation` 之后，图解还要再选一层：

| 子类型 | 用于 |
|------|------|
| `architecture` | 组件、服务、云/边界、基础设施拓扑 |
| `workflow` | 流程、审批、泳道、CI/CD |
| `sequence` | API 调用链、请求生命周期、异步时序 |
| `dataflow` | ETL/ELT 管道、数据血缘、治理 |
| `lifecycle` | 状态机、状态流转、重试与终态 |
| `freeform` | 作者自己给坐标的自由图解 |

**几何全部由运行时算**：分层、排序、坐标、正交路由、端口分配、标签避让、分组框。
你写的是 `{nodes, edges, groups}`，模型里**没有坐标字段**。

路由器对构图质量有硬保证，不需要你操心：**规避边-边交叉**、**规避通道共线重叠**、
**拒绝微段与过短折角**、**单边端口溢出自动改走次优朝向**（作者显式写的
`fromSide`/`toSide` 会被钉住、不参与搬迁）。它算不出来时会如实计入 `degradedRoutes`，
而 `degradedRoutes` 必须为 0 —— 这是 `check.mjs` 的 error。

**读者交互也全部现成**，不需要你写：搜索（`/`）、点节点看上下游、路径探查、缩放平移、
导览章节、演示模式（`f`）、缩略图、导出 PNG/SVG、深链（`#focus=` / `#view=` / `#route=`）。

各子类型的关键差异：

| 子类型 | 你写什么 | 运行时算什么 |
|---|---|---|
| `architecture` | 组件 + 连接 + 分组 | 分层、排序、坐标、分组框 |
| `sequence` | 参与者 + 消息（**不写 y**） | 列宽、消息行距、生命线、激活条、opt/loop 块 |
| `dataflow` | 阶段 + 节点（带 stage） | 阶段列宽、行内堆叠 |
| `lifecycle` | 相位 + 事件 + 转移 + 终态 | 三条带、同相位堆叠、终态对齐来源 |
| `workflow` | 泳道 + 步骤（带 lane） | 列号、泳道带高、决策节点菱形 |

## Mermaid 输入

用户贴了 Mermaid 时，**先解析再重画**，不要照搬它的样式：

```bash
node scripts/mermaid.mjs <输入.mmd> --out data.json     # 或直接输出到 stdout
```

| Mermaid | 映射到 |
|---|---|
| `flowchart` / `graph` | `workflow`（默认；`subgraph` → 泳道），`--type architecture` 可改成架构图 |
| `sequenceDiagram` | `sequence`（参与者 + 消息，虚线箭头 → 返回） |
| `stateDiagram` | `lifecycle`（状态 + 转移，`[*]` → 终态，按距离分层成相位） |

解析器只取**拓扑与语义**，几何仍由运行时算 —— 所以你不需要在模型里写坐标。
它不认识的东西（嵌套 subgraph、loop/alt 区块、样式指令）会如实列在 `warnings` 里，
不会假装还原。

## 快速路径

### 第一步：路由

按上表四选一。拿不准就问用户一句，不要猜。

### 第二步：只读三样

`authoring-contract.md` + 对应的**一个**参考 + 对应类型的 `skeleton.html`。
读完就停手，别继续翻别的文件。

### 第三步：产物优先

**下一个工具动作必须是写候选 HTML。** 从 `assets/template.html` 复制一份，填四个哨兵槽：

| 哨兵 | 放什么 |
|------|--------|
| `HEAD_SLOT` | `<title>`、`<meta name="description">`、页面专属 `<style>` |
| `BODY_SLOT` | 页面结构：标题、图表容器、控件、分步段落、图注 |
| `DATA_SLOT` | `<script type="application/json" data-craft-data="main">…</script>` |
| `SCRIPT_SLOT` | 页面逻辑。**`chart` 类型通常留空** |

第一版要克制：**一个视图、一个交互、一个系列、没有标注**。跑通了再加。

### 第四步：校验

```bash
node scripts/check.mjs <产物.html> --json
```

按 `code` + `subject` 消费诊断，套用 `supportedFixes`，重跑。

**最多两轮定向修复。** 若错误数连续两轮没有创新低，停下来如实报告剩余诊断，不要无限重试。

### 第五步：加料，再校验

**只有干净通过之后**才加：第二个系列、标注、说明卡片、打印样式。每次编辑后重跑 `check.mjs`。

### 第六步：可选视觉证据

```bash
node scripts/shot.mjs <产物.html> --json
```

**退出码 2 表示跳过（无浏览器），永远不等于通过。** 有截图就真的打开看，如实报告 `visual_review`。

### 第七步：冻结

最终干净校验后**不再编辑产物**，并留下回执：

```bash
node scripts/check.mjs <产物.html> --freeze
```

回执（`<产物>.receipt.json`）记下产物与模型的 sha256。之后产物若被改动，
再跑 `check.mjs` 会报 `receipt/artifact-modified` —— 说明之前那次「通过」已经不适用于当前内容。
**有 error 时拒绝冻结**：冻结只对干净通过的产物生效，不给坏产物盖章。

交付时报告路径、类型、校验摘要、视觉复核状态、以及回执里的哈希。

---

## 写产物时怎么分工

运行时提供横切能力，你只写因内容而异的部分：

```js
// 比例尺 —— 绝不手算坐标
const x = Craft.scale.linear({domain: [0, 100], range: [0, 600], nice: true});

// 坐标轴 —— 绝不手写刻度
Craft.axis.render(g, x, {orient: 'bottom', ticks: 6, label: '月份'});

// 图表 —— 自动 resize + 主题重绘
Craft.chart.mount('#chart', {
  height: 360,
  x: {field: 'date', type: 'time', label: '日期'},
  y: {field: 'value', type: 'linear', label: '销售额（万元）', grid: true},
  series: {field: 'region', color: 'categorical'},
  render(ctx) {
    const {x, y, color, data, height, join} = ctx;
    const bars = join('rect.mark', data, d => d.date + d.region);  // ← 必须走 join
    bars.enter.append('rect', {'class': 'mark'});
    bars.update
      .attr('x', d => x(d.date)).attr('width', Math.max(1, x.bandwidth()))
      .attr('y', d => y(d.value)).attr('height', d => height - y(d.value))
      .attr('fill', d => color(d.region));
    bars.exit.remove();
  }
});

// 控件绑定 —— 不写事件监听
const sim = Craft.bind('#controls', {
  state: {rate: 0.08, horizon: 30},
  onChange: state => draw(state)
});
```

完整签名见 `references/authoring-contract.md` 第四节。

**`chart` 类型一行 JS 都不用写** —— 用 `data-*` 属性声明即可，`Craft.boot()` 会自动挂载：

```html
<div data-craft-chart="trend"
     data-craft-chart-type="line"
     data-craft-data="main"
     data-craft-x="month" data-craft-x-type="time" data-craft-x-format="%Y-%m"
     data-craft-y="users" data-craft-y-label="新增用户（万人）"
     data-craft-series="channel"
     data-craft-height="360"
     data-craft-zoom="x"></div>
```

---

## 反模式

以下每一条都对应一类真实失败，**不要做**：

1. **不读运行时源码就动手** —— 第一个候选必须先落地，再谈优化。
2. **不手写坐标/刻度/比例尺** —— 一律用 `Craft.scale` / `Craft.axis`。手算的边界、负值、对数、时间轴全都会错。
3. **不自写 resize / 主题监听** —— `Craft.chart` 已经拥有了。重复监听会导致图形重影。
4. **在 `render` 里直接 append 而不清理** —— 必须走 `ctx.join`，否则窗口一缩放就叠加。
5. **不用硬编码颜色** —— `#fff`、`rgb(...)` 在暗色主题下会瞎。一律用 `--craft-*` 令牌。
6. **不编造数据点** —— 无真实数据时图注必须标注「示意数据」。
7. **不引入任何 CDN / 字体 / 图标库** —— 图标用内联 SVG，字体用系统栈。产物必须离线可用。
8. **不为通过检查而删除有意义的标注** —— 修内容，不修门禁。
9. **不声称未运行的检查为通过** —— 非零退出不得描述为成功；退出码 2 是跳过不是通过。
10. **不静默覆盖已有文件** —— 目标路径已存在且不是本次生成的，先问一句。
11. **不给图解写坐标** —— `data-craft-*` 模型里没有 `pos`/`size`/`x`/`y`（`freeform` 除外）。算了也会被忽略，而且几何断言会因此失去意义。

---

## 输出契约

交付时报告：

1. **产物路径**与类型
2. **校验摘要**：`check.mjs` 的 error / warning 数量
3. **视觉复核状态**：`passed`（看过截图）／`skipped (无浏览器)`／`failed`
4. **数据说明**：真实数据还是示意数据
5. **已知限制**：未解决的诊断、未验证的假设

**不得**把非零退出描述为成功，**不得**声称做过你没做的视觉检查。

---

## 质量检查

- [ ] `node scripts/check.mjs <产物>` 报 **0 error**
- [ ] 四个哨兵全部已替换或删除
- [ ] 断网打开，图形完整渲染
- [ ] 明暗主题都清晰可读
- [ ] Tab 键能走到每个可交互元素，焦点可见
- [ ] 拖动窗口改变宽度，图形不重影
- [ ] 系统开启「减少动态效果」后无自动播放动效
- [ ] 数据真实，或图注已标注「示意数据」
- [ ] 图解：`check.mjs` 的 `layout/*` 几何断言全过、`degradedRoutes` 为 0
- [ ] 图解：Tab 能逐个走到组件，点节点能看上下游
- [ ] 页面上有一句说清楚「这张图在讲什么」的话，而不是只有一张孤图
- [ ] 视觉证据：`shot.mjs` 报「浮层无遮挡」（工具条/缩略图没压住节点）
- [ ] 交付前已 `--freeze`，回执哈希与产物一致

## 交付形态

默认交付**单个 HTML 文件**。用户要求时，可以：
- 拆成 `<产物>.html` + 源数据 `.json` 两个文件
- 把产物放进用户指定的目录
- 额外导出静态 PNG（需要浏览器，用 `scripts/shot.mjs`）

不要在用户没要求时自建目录结构或附带构建配置。
