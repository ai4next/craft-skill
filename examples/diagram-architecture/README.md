# diagram / architecture 示例

`diagram` 类型（`architecture` 子类型）的完整示范 —— **模型里没有任何坐标**。

## 文件

| 文件 | 作用 |
|---|---|
| `data.json` | 拓扑模型：节点、边、分组、导览视图。没有坐标。 |
| `slots/` | 槽位源文件（`head.html` / `body.html`）。 |
| `index.html` | **生成产物**。勿手改 —— 改 `slots/` 或 `data.json` 后跑 `node scripts/sync.mjs`。 |

## 这个示例演示了什么

- **零坐标作者体验**：11 个组件、10 条边、2 个分组，作者只写拓扑。
- **自动分层与排序**：最长路径分层 + 重心排序，交叉数由运行时最小化。
- **正交路由**：端口按扇出自动铺开，标签自动避让，跨层回边绕外圈。
- **分组框**：由成员包围盒推出，不可能与成员碰撞（因为是在框内布局）。
- **导览视图**：`views[]` 定义了三个章节，可用 `?` 命令台或 `#view=` 深链打开。

## 重新生成

```bash
node scripts/sync.mjs
node scripts/check.mjs examples/diagram-architecture/index.html
```
