# 产物契约

这份文档是 `SKILL.md`、`references/*`、`scripts/check.mjs` 三者之间的**唯一接口**。
运行时读什么、checker 校验什么、你必须写什么，全部以本文件为准。

---

## 一、产物硬约束

| 约束 | 值 | 由谁强制 |
|---|---|---|
| 单文件 | 一个 `.html`，双击即开 | 人 |
| 零外链 | 无 CDN、无字体、无图标库、无 `fetch` | `artifact/no-external-ref` |
| 体积 | < 320KB 告警，> 400KB 报错 | `artifact/size-budget` |
| 内联数据 | < 120KB 告警 | `data/size` |
| 离线可用 | 断网下完整渲染 | 人（断网打开验证） |
| 主题 | 明/暗双主题，跟随系统 | `theme/prefers-color-scheme-missing` |
| 动效 | 尊重 `prefers-reduced-motion` | `a11y/reduced-motion-missing` |
| 可访问 | 键盘可达、有语义标签、非颜色线索 | `a11y/label-missing` |

图标一律用内联 SVG。需要字体就用系统字体栈（模板已定义 `--craft-font-*`）。

---

## 二、槽位协议

从 `assets/template.html` 复制一份，把四个哨兵注释**整块替换**成你的内容。
没内容可填就**删掉整个注释** —— 残留哨兵会被 `artifact/sentinel-unfilled` 拦下。

| 哨兵 | 位置 | 放什么 |
|---|---|---|
| `<!-- CRAFT:HEAD_SLOT -->` | `<head>` 内 | `<title>`、`<meta name="description">`、页面专属 `<style>` |
| `<!-- CRAFT:BODY_SLOT -->` | `<body>` 内 | 页面结构：标题、图表容器、控件、分步段落、图注 |
| `<!-- CRAFT:DATA_SLOT -->` | `<body>` 末尾 | `<script type="application/json" data-craft-data="main">…</script>` |
| `<!-- CRAFT:SCRIPT_SLOT -->` | `</body>` 前 | 页面逻辑。`chart` 类型通常留空 |

### 区域所有权

模板自带的 CSS/JS 带 `data-craft-owned` 标记，**不要改动它们**。
你写的 `<style>` / `<script>` **不要**加这个属性 —— checker 据此区分作者区与模板区，
硬编码颜色、动效守卫等规则只在作者区内生效。

```html
<!-- 模板自带，别碰 -->
<style data-craft-owned> … </style>
<script data-craft-owned> … </script>

<!-- 你写的 -->
<style> .my-chart { … } </style>
<script> … </script>
```

数据块（`type="application/json"`）不属于任何一方，checker 单独处理。

---

## 三、`data-*` 契约

### 3.1 容器

`<body>` 或产物根元素上：

| 属性 | 必需 | 取值 | 含义 |
|---|---|---|---|
| `data-craft-type` | ✅ | `chart`\|`explainer`\|`diagram`\|`simulation` | 类型路由；checker 校验枚举 |
| `data-craft-theme` | | `auto`(默认)\|`light`\|`dark` | 初始主题 |
| `data-craft-locale` | | BCP-47 | `Craft.fmt` 的语言；默认取 `<html lang>` |
| `data-craft-reduced-motion` | | `respect`(默认)\|`ignore` | 动效门禁开关 |

### 3.2 数据

```html
<script type="application/json" data-craft-data="main">
{ "rows": [ {"date": "2026-01-01", "region": "华东", "value": 128}, … ] }
</script>
```

- `data-craft-data` 的值就是 `Craft.data` 里的 key，默认 `main`。
- 顶层必须是对象或数组。约定把行数组放在 `rows` 下，但 `Craft.chart` 也接受裸数组。
- **数据必须是真实的。** 没有真实数据时，图注必须显式标注「示意数据」。

### 3.3 图表（`chart`）

| 属性 | 必需 | 取值 |
|---|---|---|
| `data-craft-chart` | ✅ | 实例 id，页面内唯一 |
| `data-craft-chart-type` | ✅ | `line`\|`area`\|`bar`\|`stacked-bar`\|`scatter`\|`heatmap`\|`sparkline`\|`custom` |
| `data-craft-data` | ✅ | 数据块 key，默认 `main` |
| `data-craft-x` / `data-craft-y` | ✅（`custom` 除外） | 字段名 |
| `data-craft-series` | | 用于拆系列的字段名 |
| `data-craft-color` | | `categorical`(默认)\|`sequential`\|`diverging` |
| `data-craft-x-type` / `-y-type` | | `linear`\|`log`\|`time`\|`band`；缺省自动推断 |
| `data-craft-height` | | 像素，默认 `360` |
| `data-craft-legend` | | `auto`(默认)\|`none` |
| `data-craft-table` | | `auto`(默认)\|`none` —— 生成视觉隐藏的 a11y 表格 |
| `data-craft-zoom` | | `x`\|`none`(默认) |

`chart-type="custom"` 时你必须提供 `render(ctx)`，`x`/`y` 可省。

### 3.4 控件（`explainer` / `simulation`）

| 属性 | 位置 | 必需 | 含义 |
|---|---|---|---|
| `data-craft-control="<stateKey>"` | `input`/`select`/`button` | ✅ | 绑定到 state 的哪个键 |
| `data-craft-output="<stateKey>"` | `<output>` | | 显示该 state 值 |
| `data-craft-format` | 同上 | | `number`\|`percent`\|`date`\|`raw` |
| `data-craft-reset` | `<button>` | | 点击恢复初始 state |

类型强制：`range`→Number、`checkbox`→Boolean、`radio`→value、
`select[multiple]`→Array、其余→String。

### 3.5 分步叙事（`explainer`）

| 属性 | 必需 | 含义 |
|---|---|---|
| `data-craft-step="0..n"` | ✅ 且从 0 连续 | 步骤序号 |
| `data-craft-step-title` | | 步骤标题（也进 rail 与 a11y） |

容器上 `data-craft-rail` 指定 rail 挂载点（可选）。

要让可视化面板吸顶，**给面板加模板提供的 `class="craft-sticky-panel"`**
（`position: sticky` + 顶部偏移 + `z-index`），或者自己写 `position: sticky`。
没有 `data-craft-sticky` 这个属性 —— 吸顶是 CSS 的事，不是运行时的开关。

### 3.6 图解（`diagram`）

图解有六个子类型，**几何全部由运行时自动布局** —— 模型里没有坐标。

| 属性 | 必需 | 含义 |
|---|---|---|
| `data-craft-diagram` | ✅ | 子类型：`architecture`\|`workflow`\|`sequence`\|`dataflow`\|`lifecycle`\|`freeform` |
| `data-craft-model` | ✅（用 JSON 模型块时） | 模型块的 key。**没有默认值** —— 不写就直接退回属性写法，JSON 块被忽略、节点数为 0 |
| `data-craft-diagram-label` | | 图的用途，进 `aria-label` |

模型放在 `<script type="application/json" data-craft-data="main">` 里。
完整字段表、六个子类型的示例、失败→修复表见 **`references/diagram-model.md`**。

≤6 个节点时也可用属性写法：`data-craft-node` / `data-craft-node-label` /
`data-craft-node-kind` / `data-craft-node-group` / `data-craft-edge="a->b"`。

### 3.7 模拟（`simulation`）

| 属性 | 必需 | 含义 |
|---|---|---|
| `data-craft-sim="<id>"` | ✅ | 实例 id |
| `data-craft-frame` | | `manual`(默认)\|`raf` —— 默认只在 state 变化时重绘 |
| `data-craft-speed="<stateKey>"` | | 该 state 键控制步进速度 |

### 3.8 通用可访问性

- 任何响应 hover/click 的元素必须**原生可聚焦**，或带 `tabindex="0"` + `aria-label`。
- 纯装饰性 SVG 带 `aria-hidden="true"`；有语义的 SVG 带 `role="img"` + `aria-label` 或 `<title>`。
- `<img>` 必须有 `alt`。
- 状态不能只靠颜色表达 —— 同时用形状、线型、标签或图案。

### 3.9 按类型的必需项矩阵

| 类型 | 必需 |
|---|---|
| `chart` | `data-craft-chart*` 属性组 + 数据块 |
| `explainer` | ≥3 个连续的 `data-craft-step` |
| `diagram` | `data-craft-diagram` 子类型 + 模型块（或 ≥2 个 `data-craft-node`） |
| `simulation` | `data-craft-sim` + ≥1 个 `data-craft-control` |

---

## 四、运行时速查

完整签名见 `assets/template.html` 内的运行时源码。**写第一个候选之前不要读它。**

```js
// 比例尺 —— 绝不手算坐标
const x = Craft.scale.linear({domain: [0, 100], range: [0, 600], nice: true});
x(50); x.invert(300); x.ticks(5);
Craft.scale.band({domain: ['A','B'], range: [0,600], padding: 0.2}).bandwidth();
Craft.scale.time({domain: [t0, t1], range: [0, 600]});   // 刻度数由 f.ticks(n) 定，没有 ticks 选项

// 轴 —— 绝不手写刻度
Craft.axis.render(g, x, {orient: 'bottom', ticks: 6, label: '日期'});
Craft.axis.render(g, y, {orient: 'left', grid: true, label: '销售额（万元）'});

// 图表 —— 自动 resize + 主题重绘
const chart = Craft.chart.mount('#chart', {
  height: 360, margin: {t: 24, r: 24, b: 44, l: 60},
  x: {field: 'date', type: 'time', label: '日期'},
  y: {field: 'value', type: 'linear', label: '销售额（万元）', grid: true},
  series: {field: 'region', color: 'categorical'},
  legend: 'auto', table: 'auto',
  render(ctx) {
    const {x, y, color, data, height, join} = ctx;
    const bars = join('rect.mark', data, d => d.date + d.region);   // ← 必须走 join
    bars.enter.append('rect').attr('class', 'mark').attr('rx', 2);
    bars.update
      .attr('x', d => x(d.date)).attr('width', Math.max(1, x.bandwidth()))
      .attr('y', d => y(d.value)).attr('height', d => height - y(d.value))
      .attr('fill', d => color(d.region));
    bars.exit.remove();
  }
});

// 现成 mark，直接当 render 用
render: Craft.marks.line   // line | area | bar | stackedBar | scatter | heatmap | sparkline

// 控件绑定 —— 不写事件监听
const sim = Craft.bind('#controls', {
  state: {rate: 0.08, horizon: 30},
  onChange: (state) => draw(state)
});
draw(sim.state);   // ← 必须自己画一次：onChange 只在读者动控件时才触发，
                   //   不补这一句首屏就是空的 —— 而默认状态必须自解释

// 分步叙事
Craft.step('#story', {rail: '#step-rail', onStep: (i) => view.show(i)});

// 颜色 —— 实时读 CSS 变量，主题切换免费生效
Craft.color.categorical(0); Craft.color.sequential(0.5); Craft.color.diverging(0.2);

// 数字/日期格式化
Craft.fmt.number(1234567);   // 1,234,567
Craft.fmt.compact(1234567);  // 123万
Craft.fmt.percent(0.42);     // 42%
Craft.fmt.date(t, '%m-%d');

// 动效 —— reduced-motion 下自动变瞬时
Craft.animate.to(el, {opacity: 1}, {duration: 300});

// 主题
Craft.theme.toggle(); Craft.theme.current(); Craft.theme.onChange(cb);

// 自定义图表：解析期注册，boot 挂载时自动取用
// （不要在 DOMContentLoaded 里挂载 —— boot 总是先跑，会先挂一次）
Craft.chart.define('valueFn', {
  data: rows,                                  // 或让作者写 data-craft-data
  x: {field: 'v', type: 'linear', label: '得失'},
  y: {field: 'val', type: 'linear', label: '主观价值'},
  render(ctx) { /* 必须走 ctx.join */ }
});
// <div data-craft-chart="c" data-craft-chart-type="custom"
//      data-craft-chart-render="valueFn"></div>

// 等运行时就绪。不要直接监听 craft:ready —— 作者脚本注册得比 boot 晚，会错过
Craft.ready(function () { /* 此时图表/模拟都已挂载 */ });

// 图解：零 JS 声明式挂载。模型里没有坐标，几何由运行时算。
// <div data-craft-diagram="architecture" data-craft-model="main"></div>
const inst = Craft.diagram.mount('#d', {});   // 或交给 Craft.boot() 自动挂载
inst.focus('api');                            // 聚焦并缩放过去
inst.stats.degradedRoutes;                    // 路由器自己承认失败的次数，应为 0
```

---

## 五、验收清单

交付前逐条确认：

- [ ] `node scripts/check.mjs <产物.html>` **0 error**
- [ ] 四个哨兵全部已替换或删除
- [ ] 断网打开，图形完整渲染
- [ ] 明/暗主题切换，文字与图形都清晰可读
- [ ] 键盘 Tab 能走到每个可交互元素，焦点可见
- [ ] 拖动窗口改变宽度，图形**不重影、不叠加**
- [ ] 系统开启「减少动态效果」后，无自动播放动效
- [ ] 数据是真实的，或图注已标注「示意数据」
- [ ] 非零退出**没有**被描述为成功

---

## 六、失败 → 修复

`check.mjs --mirror` 会校验这张表覆盖了 checker 能报出的**每一个**诊断码
（`docs/diagnostic-undocumented`）。加了新规则就必须在这里补一行。

### 结构（artifact / html / data / perf）

| 诊断 code | 含义 | 怎么修 |
|---|---|---|
| `artifact/no-external-ref` | 引了外部资源 | 把资源内联；图标改内联 SVG；字体改系统栈 |
| `artifact/size-budget` | 体积超标（>400KB） | 降采样数据、砍掉未使用的系列、精简标注 |
| `artifact/runtime-budget` | 运行时占比过高且产物偏大 | 运行时是固定成本；降采样内联数据留出余量 |
| `artifact/runtime-stale` | 产物里的运行时与 `assets/template.html` 不一致 | `node scripts/sync.mjs` 重新生成 |
| `artifact/sentinel-unfilled` | 哨兵没填 | 填内容或删掉整条注释 |
| `html/lang-missing` | `<html>` 缺 `lang` | 加 `lang="zh-CN"` |
| `html/title-missing` | 缺 `<title>` | 在 `HEAD_SLOT` 加 |
| `html/viewport-missing` | 缺 viewport | 加 `<meta name="viewport" content="width=device-width, initial-scale=1">` |
| `data/json-invalid` | 数据块解析失败 | 按回执给的行列位置修 JSON |
| `data/json-missing` | 有图表但无数据块 | 加 `data-craft-data` 块 |
| `data/size` | 内联数据过大 | 聚合到周/月，或降采样 |
| `perf/dom-node-budget` | DOM 节点过多 | 聚合数据；改用热力图；抽样 |

### 契约（contract / deck）

| 诊断 code | 含义 | 怎么修 |
|---|---|---|
| `contract/type-unknown` | 类型缺失或拼错 | 设为四类之一 |
| `contract/chart-fields` | 字段在部分行缺失 | 统一字段名，或补全数据 |
| `contract/step-sequence` | 步骤号不连续 | 重新编号为 0..n-1 |
| `contract/control-unbound` | 控件键不在 state 里 | 在 `Craft.bind` 的 `state` 加该键 |
| `contract/diagram-subtype` | 子类型拼错 | 改成六个子类型之一 |
| `contract/type-mismatch` | `<body>` 声明的类型与页面实际内容不符 | 把 `data-craft-type` 改成实际类型 |
| `deck/deeplink-target` | 视图引用了不存在的节点 | 改成已有 id |

### 模型（model）

| 诊断 code | 含义 | 怎么修 |
|---|---|---|
| `model/schema` | 缺必需字段 / 无节点 / 节点缺 id / kind 不属于该子类型 | 按 `evidence` 补字段 |
| `model/dangling-edge` | 边的端点不存在 | 改成已有节点 id |
| `model/duplicate-id` | 节点 id 重复 | 改成唯一 id |
| `model/label-budget` | 标签过长 | 节点 ≤18 字、边 ≤12 字 |
| `model/edge-label-density` | 超过六成边带标签 | 只留关键几条 |
| `model/cycle-in-dag` | 架构/流程/数据流里成环 | 确认是否有意；状态机用 `lifecycle` |
| `model/self-loop` | 节点有指向自己的边 | 删掉，或确认有意（状态机重试允许） |
| `model/orphan-node` | 节点没连接也没分组 | 加边、归组或删掉 |
| `model/sequence-order` | 消息端点不是参与者 | 加进 `participants` |
| `model/lifecycle-terminal` | 失败态没有回退路径 | 加回退转移，或改成 `terminal` |
| `model/viewbox-fit` | 用了 `viewBox` | 删掉，让运行时自适应 |
| `model/node-budget` | 节点/边过多 | 拆图 |
| `model/unknown-lane` | 步骤的 `lane` 不是已声明的泳道 | 加进 `lanes`，或改 id |
| `model/unknown-stage` | 节点的 `stage` 不是已声明的阶段 | 加进 `stages`，或改 id |
| `model/unknown-phase` | 事件的 `phase` 不是已声明的相位 | 加进 `phases`，或改 id |
| `model/unknown-group` | 节点的 `group` 不是已声明的分组 | 加进 `groups`，或改 id |
| `model/block-range` | `blocks[].from/to` 不是有效消息下标 | 改成 `0..messages.length-1` |
| `model/direction-invalid` | `direction` 拼错（会被静默当成 TB） | 改成 `TB`\|`LR`\|`BT`\|`RL` |

### 布局几何（layout）

| 诊断 code | 含义 | 怎么修 |
|---|---|---|
| `layout/no-overlap` | 节点重叠 | 拓扑有歧义，减少同层节点或加分组 |
| `layout/in-viewbox` | 节点跑到画布外 | 删掉 `viewBox`，或减少内容 |
| `layout/no-edge-through-node` | 边穿过无关节点 | 减少跨层连接 |
| `layout/no-label-collision` | 两个标签互相压叠 | 缩短标签、减少带标签的边 |
| `layout/label-masked` | 标签找不到无冲突位置，已降级为带底色的遮挡态 | 缩短标签、减少同区域边、加分组 |
| `layout/corridor-shared` | 两条无关边在同一条通道上共线重叠（warning） | 减少同向的平行边、加分组；`architecture` 还可以调 `nodes[].order` |
| `layout/route-rhythm` | 边有微段（<8px）或过短的折角（warning） | 减少跨层连接、缩短标签 |
| `layout/degraded-route` | 有边没找到合规路由 | 减少跨层连接、缩短标签、加分组 |
| `layout/crossing-budget` | 交叉过多（分层交叉与路由交叉取较大值） | 拆图，或加分组把相关节点拉近；`architecture` 还可以用 `nodes[].order` 调顺序 |
| `layout/deterministic` | 两次布局不一致 | 检查是否引入随机或依赖对象键序 |
| `layout/runtime-missing` | 有图解模型却没有可执行的运行时 | 确认 `data-craft-owned` 区块还在，重新生成产物 |
| `layout/sandbox-failed` | 布局引擎在 Node 沙箱里执行失败 | 确认 `data-craft-owned` 区块没被手改 |
| `layout/assert-failed` | 几何断言自身抛错 | 检查模型字段类型 |

### 无障碍与主题（a11y / theme）

| 诊断 code | 含义 | 怎么修 |
|---|---|---|
| `a11y/diagram-name` | 图解容器没有可读名称 | 加 `data-craft-diagram-label` |
| `a11y/reduced-motion-missing` | 动效无守卫 | 改用 `Craft.animate`，或加 `@media (prefers-reduced-motion: reduce)` |
| `a11y/label-missing` | 图形无标签 | 加 `aria-label` / `<title>` / `alt` |
| `theme/prefers-color-scheme-missing` | 无系统主题跟随 | 保留模板自带的媒体查询，别删 |
| `theme/hardcoded-color` | 作者区硬编码颜色 | 改成 `var(--craft-*)` |
| `theme/contrast` | 令牌对比度不足 | 调令牌值；分类色换更深的 |

### 仓库一致性（mirror / docs）

只在 `--mirror` 下检查 —— 这三条是给技能维护者看的，不是产物的问题。

| 诊断 code | 含义 | 怎么修 |
|---|---|---|
| `mirror/stale` | 镜像过期或缺失 | `node scripts/sync.mjs` |
| `docs/diagnostic-undocumented` | 本表漏了 checker 能报的诊断码 | 在「失败 → 修复」表里补上 `evidence.missing` 列出的码 |
| `docs/enum-drift` | `check.mjs` 的子类型/节点种类表与运行时不一致 | 按 `evidence.runtime` 改正 `check.mjs` 的静态表 |

### 回执（receipt）

| 诊断 code | 含义 | 怎么修 |
|---|---|---|
| `receipt/artifact-modified` | 产物在冻结之后被改过，之前那次「通过」已作废 | 重新校验并冻结：`node scripts/check.mjs <产物> --freeze` |
| `receipt/unreadable` | 回执文件损坏 | 删掉它重新冻结 |

---

## 七、checker 明确**不做**的事

这些需要浏览器或人，`check.mjs` 不假装能判断 —— 空洞的规则比没有规则更糟：

- HTML / CSS 合法性
- 布局是否溢出、标签是否被裁切
- 「这张图好不好读」
- JS 是否真的跑起来了（语法错误、运行时异常）
- 数据是否真实

这些交给 `scripts/shot.mjs` 的截图 + 你自己的眼睛。截图命令退出码 2 表示**跳过**（无浏览器），
永远不等于通过。
