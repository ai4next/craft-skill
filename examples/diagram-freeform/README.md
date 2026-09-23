# freeform 示例

唯一一个**作者显式给坐标**的子类型：节点用 `pos: [x, y]` 指定位置，
可选 `size: [w, h]` 指定尺寸（不写则按文字量推算）。

其余五个子类型的模型里都没有坐标 —— 几何全部由运行时算。freeform 是给
「布局有明确语义、自动排不出来」的场景留的出口。

边仍然走正交路由器：仍会规避交叉、通道共线、微段，仍然算 `degradedRoutes`。

```bash
node ../../scripts/check.mjs index.html
```
