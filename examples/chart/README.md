# chart 示例

`chart` 类型的完整示范 —— 一个页面、两个图表、**零行作者 JS**。

## 文件

| 文件 | 作用 |
|---|---|
| `skeleton.html` | **给 agent 读的最小骨架**（~6KB）。只演示「四个哨兵槽里写什么」，不含完整运行时，读完不需要再看 `assets/template.html` 的源码。 |
| `slots/` | 完整示例的槽位源文件（`head.html` / `body.html`）。 |
| `data.json` | 源数据。 |
| `index.html` | **生成产物**（~91KB）。勿手改 —— 改 `slots/` 或 `data.json` 后跑 `node scripts/sync.mjs`。 |

## 这个示例演示了什么

- **全声明式挂载**：两个图表都由 `Craft.boot()` 从 `data-*` 属性自动挂载，`SCRIPT_SLOT` 是空的。
- **双系列 + 图例**：`data-craft-series="channel"` 按渠道拆线，图例自动生成，色块带 `data-pattern` 非颜色线索。
- **时间轴自动刻度**：`data-craft-x-type="time"` + `%Y-%m` 格式，刻度粒度自动选到「每 2 个月」。
- **x 轴缩放**：`data-craft-zoom="x"` 启用滚轮缩放 + 拖拽平移 + 双击复位。
- **可访问性**：每个数据点 `tabindex="0"` + `aria-label`；`data-craft-table="auto"` 生成视觉隐藏的完整数据表，并通过 `aria-describedby` 与 svg 关联。
- **主题令牌**：`slots/head.html` 里的样式只用 `var(--craft-*)`，明暗主题切换自动生效。

## 重新生成

```bash
node scripts/sync.mjs                          # 重新组装 index.html
node scripts/check.mjs examples/chart/index.html   # 必须 0 error
```

`check.mjs` 有一条 `artifact/runtime-stale` 规则：产物携带的 `data-craft-owned` 运行时区块
必须与当前 `assets/template.html` 逐字节一致。所以模板一改，这个示例就会立刻报错，
不会被误当成有效证明。
