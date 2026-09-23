# 图解模型契约

做 `diagram` 类型时读这份。**模型里没有任何坐标** —— 这是与同类工具最本质的区别。

---

## 一、容器

```html
<div data-craft-diagram="architecture"
     data-craft-model="main"
     data-craft-diagram-label="订单系统运行时架构图"></div>
```

| 属性 | 必需 | 说明 |
|---|---|---|
| `data-craft-diagram` | ✅ | 子类型：`architecture`\|`workflow`\|`sequence`\|`dataflow`\|`lifecycle`\|`freeform` |
| `data-craft-model` | | 模型块的 key，默认 `main`。不写则退回属性写法 |
| `data-craft-diagram-label` | | 图的用途，进 `aria-label`。缺了会告警 |

模型放在 `<script type="application/json" data-craft-data="main">` 里。

≤6 个节点时也可以用属性写法：

```html
<g data-craft-node="api" data-craft-node-label="API 网关" data-craft-node-kind="frontend"></g>
<path data-craft-edge="api->db" data-craft-edge-label="SQL"></path>
```

---

## 二、通用字段

| 字段 | 必需 | 说明 |
|---|---|---|
| `kind` | ✅ | 子类型，与 `data-craft-diagram` 一致 |
| `direction` | | `TB`(默认) \| `LR` \| `BT` \| `RL`，只对 `architecture`/`workflow`/`freeform` 生效 |
| `title` / `subtitle` | | 标题与副标题 |
| `viewBox` | | **不要用**。这是裁剪框，不是自适应 |
| `nodes[]` | ✅ | 见下 |
| `edges[]` | | 见下 |
| `groups[]` | | `{id, label}`，节点用 `group` 字段归属 |
| `views[]` | | 最多 5 个 `{id, label, focus:[节点id], note}`，导览章节 |

### `nodes[]`

| 字段 | 必需 | 说明 |
|---|---|---|
| `id` | ✅ | 唯一，`[A-Za-z0-9_-]+` |
| `label` | ✅ | ≤ **18 个汉字**（拉丁按半个字算） |
| `sublabel` | | ≤ 24 字 |
| `kind` | | 见各子类型；决定配色 |
| `group` | | 分组 id |
| `order` | | 同层内的排序权重，平局时用 |
| `rank` | | 强制指定层级（`architecture`/`workflow`/`dataflow`） |
| `pos` | | **只有 `freeform` 用**。其他子类型给了也会被忽略 |

**没有 `width` / `height` / `size`** —— 框的大小由标签内容算出来。

### `edges[]`

| 字段 | 必需 | 说明 |
|---|---|---|
| `from` / `to` | ✅ | 必须是已存在的节点 id |
| `label` | | ≤ **12 个汉字**。边标签超过六成会互相压叠 |
| `variant` | | `default` \| `emphasis` \| `dashed` |
| `fromSide` / `toSide` | | `auto`(默认) \| `left` \| `right` \| `top` \| `bottom`。显式指定时**钉住**：单边端口溢出（`maxPerSide`）不会把它挪到别的朝向 |

**没有 `route` / `via` / `channelX` / `channelY`** —— 路由由运行时算。

---

## 三、各子类型

### `architecture` —— 组件、服务、边界

```json
{ "kind": "architecture", "direction": "LR",
  "groups": [ { "id": "core", "label": "核心服务" } ],
  "nodes": [
    { "id": "client", "label": "客户端", "sublabel": "Web / 移动端", "kind": "external" },
    { "id": "gateway", "label": "API 网关", "kind": "frontend" },
    { "id": "order", "label": "订单服务", "kind": "backend", "group": "core" },
    { "id": "pg", "label": "PostgreSQL", "kind": "database", "group": "core" } ],
  "edges": [
    { "from": "client", "to": "gateway", "label": "HTTPS" },
    { "from": "gateway", "to": "order" },
    { "from": "order", "to": "pg", "label": "读写" } ] }
```

节点 `kind`：`frontend`（蓝）`backend`（红）`database`（绿）`cloud`（琥珀）
`security`（紫）`messagebus`（青）`external`（粉）

布局：最长路径分层 → 重心排序 → 优先级坐标。分组框由成员包围盒推出。

### `sequence` —— 调用链、请求生命周期

```json
{ "kind": "sequence",
  "participants": [
    { "id": "u", "label": "用户" }, { "id": "gw", "label": "网关" },
    { "id": "svc", "label": "订单服务" }, { "id": "db", "label": "PostgreSQL" } ],
  "messages": [
    { "from": "u", "to": "gw", "label": "POST /orders" },
    { "from": "gw", "to": "svc", "label": "createOrder()" },
    { "from": "svc", "to": "db", "label": "INSERT" },
    { "from": "db", "to": "svc", "label": "ok", "kind": "return" },
    { "from": "svc", "to": "gw", "label": "201 Created", "kind": "return" } ] }
```

**消息不写 `y`** —— 顺序即时间顺序，纵坐标由运行时累加。
列间距按最长标签算，不需要 `column_fit` 之类的修复开关。

### `dataflow` —— ETL、血缘、管道

```json
{ "kind": "dataflow",
  "stages": [ { "id": "src", "label": "数据源" }, { "id": "wh", "label": "数仓" } ],
  "nodes": [
    { "id": "app", "label": "埋点事件", "stage": "src", "kind": "source" },
    { "id": "crm", "label": "CRM 导出", "stage": "src", "kind": "source" },
    { "id": "dbt", "label": "dbt 模型", "stage": "wh", "kind": "transform" } ],
  "flows": [
    { "from": "app", "to": "dbt", "label": "raw" },
    { "from": "crm", "to": "dbt" } ] }
```

节点 `kind`：`source` `transform` `store` `consumer`

### `lifecycle` —— 状态机、重试、终态

```json
{ "kind": "lifecycle",
  "phases": [ { "id": "p1", "label": "创建" }, { "id": "p2", "label": "已支付" } ],
  "events": [
    { "id": "draft", "label": "草稿", "phase": "p1", "type": "normal" },
    { "id": "paid", "label": "已支付", "phase": "p2", "type": "normal" },
    { "id": "failed", "label": "支付失败", "phase": "p2", "type": "failure" } ],
  "transitions": [
    { "from": "draft", "to": "paid", "label": "提交" },
    { "from": "paid", "to": "failed", "label": "拒付" },
    { "from": "failed", "to": "paid", "label": "重试" } ],
  "outcomes": [ { "id": "refund", "label": "已退款" } ] }
```

节点 `type`：`normal` \| `failure` \| `terminal`

**硬规则**：`failure` 状态必须有回到非终态的转移，否则读者会以为流程卡死了。
`check.mjs` 的 `model/lifecycle-terminal` 会拦。

### `workflow` —— 流程、审批、CI/CD

```json
{ "kind": "workflow",
  "lanes": [ { "id": "dev", "label": "开发" }, { "id": "ci", "label": "CI" } ],
  "steps": [
    { "id": "push", "label": "git push", "lane": "dev", "kind": "start" },
    { "id": "test", "label": "测试通过？", "lane": "ci", "kind": "decision" },
    { "id": "live", "label": "上线", "lane": "ci", "kind": "end" } ],
  "edges": [
    { "from": "push", "to": "test" },
    { "from": "test", "to": "live", "label": "是" },
    { "from": "test", "to": "push", "label": "否", "kind": "retry" } ] }
```

节点 `kind`：`start` `end` `task` `decision`（菱形）`io`

### `freeform` —— 作者给坐标

```json
{ "kind": "freeform",
  "nodes": [
    { "id": "a", "label": "A", "pos": [40, 40] },
    { "id": "b", "label": "B", "pos": [260, 160] } ],
  "edges": [ { "from": "a", "to": "b" } ] }
```

只有这一种类型允许（也要求）`pos`。没给 `pos` 的节点会自动排到下方一行。
即便给了坐标，**边的路由仍然由运行时算**。

---

## 四、读者交互（全部现成，不用你写）

挂载后自动具备：

| 操作 | 快捷键 | 效果 |
|---|---|---|
| 搜索组件 | `/` | 按标签、副标题、类型、id 搜 |
| 聚焦组件 | 点击 / Enter | 面板显示详情 + 上下游可达数 |
| 上下游追踪 | 面板按钮 | 高亮可达节点，其余变暗 |
| 路径探查 | `inst.showPath(a, b)` | 高亮最短有向路径 |
| 缩放 | `+` / `−` / 滚轮 | 缩放平移，缩到最小时自动隐藏次要文字 |
| 适应窗口 | `0` | 复位 |
| 导览章节 | `[` / `]` / rail 按钮 | 按 `views[]` 逐章聚焦 |
| 演示模式 | `f` | 收起外壳，把舞台让给图 |
| 导出 | 工具栏 `⤓` | PNG（2×，自动避开 16MiB 画布上限）与 SVG（自包含、可再主题化） |
| 缩略图 | — | 右下角，点击可跳转 |
| 帮助 | `?` | 快捷键速查 |

**深链**（写回用 `replaceState`，不污染浏览历史）：

```
#focus=api                聚焦到某个组件
#focus=api&reach=down     聚焦并高亮其下游
#route=client~pg          高亮两点间的最短有向路径
#view=entry               打开某个导览章节
```

`?theme=light|dark` 与 `?present=1` 也支持。

## 五、可访问性

- 容器要有 `data-craft-diagram-label`。
- 每个节点自动获得 `tabindex="0"` 与「类型：标签（副标题）」的 `aria-label`。
- 节点可用 Tab 逐个聚焦，Enter/Space 聚焦查看。
- 状态不只靠颜色 —— 节点形状（矩形/胶囊/菱形）与分组虚线也承载语义。

---

## 六、常见失败与修复

| 诊断 code | 含义 | 怎么修 |
|---|---|---|
| `model/dangling-edge` | 边的端点不存在 | 改成已有 id，或补上该节点 |
| `model/duplicate-id` | 节点 id 重复 | 改成唯一 id |
| `model/label-budget` | 标签过长 | 节点 ≤18 字、边 ≤12 字；细节移到 sublabel |
| `model/edge-label-density` | 超过六成边带标签 | 只留关键几条 |
| `model/cycle-in-dag` | 架构/流程/数据流里成环 | 确认是否有意；状态机请用 `lifecycle` |
| `model/orphan-node` | 节点没连接也没分组 | 加边、归组，或删掉 |
| `model/sequence-order` | 消息端点不是参与者 | 加进 `participants` |
| `model/lifecycle-terminal` | 失败态没有回退路径 | 加一条回退转移，或改成 `terminal` |
| `model/viewbox-fit` | 用了 `viewBox` | 删掉，让运行时自适应 |
| `deck/deeplink-target` | 视图引用了不存在的节点 | 改成已有 id |
| `layout/no-overlap` | 节点重叠 | 拓扑有歧义，减少同层节点或加分组 |
| `layout/no-edge-through-node` | 边穿过无关节点 | 减少跨层连接 |
| `layout/degraded-route` | 有边没找到合规路由 | 减少跨层连接、缩短标签、加分组 |
| `layout/crossing-budget` | 交叉过多 | 用 `nodes[].order` 调整同层顺序，或拆图 |
| `layout/deterministic` | 两次布局不一致 | 布局必须可复现，检查是否引入随机 |
| `a11y/diagram-name` | 图解容器没有可读名称 | 加 `data-craft-diagram-label` |

---

## 七、为什么没有坐标

同类工具要求你为每个节点写 `pos:[x,y]` 和 `size:[w,h]`，然后用一堆校验器检查这些手写坐标有没有重叠、有没有压住别的元素。一个 8 节点的图要写 249 行 JSON。

craft 反过来：**你只描述拓扑，几何由运行时算**。代价是布局算法要足够好；收益是坏几何根本不可能产生，而且 `check.mjs` 能在 Node 里跑同一份布局引擎，把「几何对不对」从「截图碰运气」变成 `exit 1` 加精确行号。
