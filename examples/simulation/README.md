# simulation 示例

一个可探索模拟：**排队长度随利用率的非线性增长**。

演示的运行时能力：

- `Craft.sim.define` 注册模型 + `[data-craft-sim]` 自动挂载
- `data-craft-frame="manual"` —— 默认手动推进，读者能停下来看（自动播放会让人失去控制感）
- `reset(ctx)` 在参数变化时清空历史（否则新旧参数的结果会接成一条曲线，读出错结论）
- `Craft.bind` 控件 + `data-craft-output` 实时数值 + `data-craft-sim-step` / `-reset` 按钮
- `Craft.chart.mount` + `Craft.marks.area` 画队列曲线

**模型是确定性的**：没有 `Math.random`，同样的参数必然得到同样的曲线。
这是 `references/explainer-craft.md` 里点名要求的 —— 否则读者每次跑出的结论都不一样。

历史数组有上限（`WINDOW`），不会因为长时间推进而无限增长。

```bash
node ../../scripts/check.mjs index.html
```
