# explainer 示例

一个可探索解释：**复利的时间不对称性**。

按 `references/explainer-craft.md` 的五段叙事结构组织 ——
钩子（先猜一个数）→ 直觉（钱按已有金额生钱）→ 机制（拆成三段）→
边界（取出利息 / 收益率波动）→ 应用（三个判断）。

演示的运行时能力：

- `Craft.step` 分步叙事 + `data-craft-rail` 导览栏（↑↓ / PgUp/PgDn 可翻步）
- `Craft.bind` 控件绑定：滑杆 / 开关 / 重置，含 `data-craft-output` 实时数值
- `Craft.chart.mount` + `Craft.marks.line` 双系列折线
- **渐进披露**：年限滑杆在第 3 步才出现，取出开关在第 4 步才出现

`slots/script.html` 里的 `project(state)` 是纯函数 —— 同样的参数必然得到同样的序列。

```bash
node ../../scripts/check.mjs index.html
```
