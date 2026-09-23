# 可探索解释与模拟

做 `explainer` 与 `simulation` 时读这份。

核心区别：`chart` 让读者**看见**结论；`explainer` 让读者**自己得出**结论。
后者靠的是「先制造困惑，再给出机制」—— 而不是把结论排版得更好看。

---

## 一、叙事结构

一个可探索解释的骨架，五段：

| 段 | 作用 | 篇幅 |
|---|---|---|
| **钩子** | 给一个反直觉的现象、一个具体问题、一个数字 | 1 屏 |
| **直觉** | 用读者已有的经验搭桥，不给公式 | 1-2 屏 |
| **机制** | 拆开来看：变量、关系、为什么是这样 | 2-4 屏 |
| **边界** | 什么条件下不成立、常见的误解 | 1 屏 |
| **应用** | 读者能拿它做什么判断 | 1 屏 |

**跳过「直觉」是最常见的失败。** 直接从钩子跳到公式，读者只会觉得「哦，很厉害」然后忘掉。

---

## 二、渐进披露

读者一次只能处理一个新概念。

- **每步只引入一个新变量。** 第二、三步再解锁其余控件。
- **先具体，后抽象。** 先给一个真实数字跑一遍，再给通式。
- **控件默认值要能直接看懂。** 读者不动任何东西时，应该已经能看到一个完整、正确的例子。
- **不要让读者面对一堵控件墙。** 6 个滑杆同时出现，读者会一个都不动。

实现上：用 `Craft.step` 的分步叙事，在 `onStep` 回调里控制哪些控件可见/可用。

---

## 三、控件设计

控件是解释的**动词**。每个控件都要对应叙事里的一个「如果……会怎样？」。

| 控件 | 适合 | 不适合 |
|---|---|---|
| 滑杆 `range` | 连续参数（速率、阈值、比例） | 二值开关 |
| 开关 `checkbox` | 二值假设（开/关某机制） | 多选一 |
| 下拉 `select` | 离散场景（数据集、模式） | 需要「边拖边看」的参数 |
| 单选 `radio` | 2-4 个互斥视角 | 超过 4 个 |

**规则：**

1. **每个控件旁边必须有实时数值** —— 用 `<output data-craft-output="rate">`。读者拖的时候要知道自己在拖什么。
2. **范围要合理。** 滑杆 `min`/`max` 让读者能试出「太大就崩」「太小没反应」的边界，才有探索感。全范围都平淡说明参数选错了。
3. **变化要即时。** 不要加「应用」按钮。
4. **`data-craft-reset` 按钮**：读者玩乱了要能回到起点。
5. **控件要能键盘操作。** 原生 `<input>` 天然可以；自定义控件要自己补 `tabindex` + 方向键。

---

## 四、状态 ↔ 视图联动

`Craft.bind` 管状态，你管「状态怎么变成画面」：

```js
const view = Craft.bind('#controls', {
  state: {rate: 0.08, horizon: 30, vaccine: 60},
  onChange: (state) => {
    const series = simulate(state);        // 纯函数：state → 数据
    chart.update(series);                  // chart 自己处理 resize 与重绘
    readout.textContent = summarize(series);
  }
});
```

**要点：**

- **把 `simulate(state)` 写成纯函数。** 同样的 state 必须得到同样的结果 —— 否则读者一拖动就得到不同结论，解释就废了。
- **别在 `onChange` 里手动重建 DOM。** 走 `chart.update()`，它内部用 `ctx.join` 保证不重影。
- **拖滑杆时 `onChange` 已被合并到单帧**（运行时用 `requestAnimationFrame` 合并），不用自己 debounce。
- **重计算超过 ~16ms 就在图注里说明**，或降低分辨率（模拟步数、网格密度）。

---

## 五、写模拟（`simulation`）

```js
Craft.sim.define('sir', {
  state: {beta: 0.3, gamma: 0.1, population: 1000, days: 160},
  reset(ctx) { ctx.sim.acc = null; },          // 参数变了：清掉历史
  step(ctx) {                                   // 推进一帧
    const {state, sim} = ctx;
    sim.series = sim.series || initialSeries(state);
    sim.series = advance(sim.series, state);
  },
  draw(ctx) {                                   // 画当前帧
    ctx.sim.chart && ctx.sim.chart.update(ctx.sim.series);
  },
  autostart: false
});
```

页面侧：

```html
<div data-craft-sim="sir" data-craft-frame="manual">
  <div class="craft-field">
    <label for="beta">传染率 <output data-craft-output="beta" data-craft-digits="2"></output></label>
    <input id="beta" type="range" min="0.05" max="1" step="0.05" value="0.3"
           data-craft-control="beta">
  </div>
  <button class="craft-btn" type="button" data-craft-sim-step>单步</button>
  <button class="craft-btn" type="button" data-craft-sim-reset>重置</button>
</div>
```

**`data-craft-frame`：**

| 值 | 行为 | 用于 |
|---|---|---|
| `manual`（默认） | 只在参数变化或点单步时重绘 | 大多数解释型模拟 —— 读者要能停下来看 |
| `raf` | 每帧连续推进 | 真正的动态过程（粒子、波动） |

**默认用 `manual`。** 自动播放的模拟会让读者失去控制感，而且违反「减少动态效果」时不好处理。

**模拟的三个常见错误：**

1. **确定性不足** —— 用了 `Math.random()` 但没固定种子，读者每次得到不同结果。要么去掉随机，要么把种子做成可见参数。
2. **状态爆炸** —— 每帧往数组里 push，跑几分钟就卡死。设上限（滚动窗口、固定步数）。
3. **没有稳态** —— 参数怎么调都收敛到同一个结果，读者探索不到任何东西。先自己试几组极端值。

---

## 六、可访问性

分步叙事特别容易做成键盘不可达。运行时已经处理了大部分：

- `Craft.step` 给每步标题加 `tabindex="-1"`，↑↓ / PgUp/PgDn / Home/End 在故事内可翻步。
- rail（`data-craft-rail`）渲染成 `<button>`，带「第 3 步，共 7 步：标题」的 `aria-label`，整个叙事不用滚动也能走完。
- **焦点在故事之外时，方向键不会被劫持** —— 这是有意为之，别去改。
- `#step=N` 深链便于分享特定步骤（**只有 hash 形式**，`?step=N` 不生效；查询串里只有 `?theme=` 与 `?present=1`）。

你要做的：

- 每个 `<svg>` 要么 `role="img"` + `aria-label`，要么 `aria-hidden="true"`。
- 纯视觉装饰不承载信息 —— 信息要在文字里也说一遍。
- 控件都有 `<label>`，`<output>` 用 `for` 关联。
- 动画走 `Craft.animate`，它会自动尊重 `prefers-reduced-motion`。

---

## 七、交付前的自检

- [ ] 有没有一个具体的钩子，而不是从定义开始？
- [ ] 有没有「直觉」这一段？还是直接跳到了机制？
- [ ] 每步是不是只引入一个新概念？
- [ ] 控件默认值下，读者能看到一个完整正确的例子吗？
- [ ] 每个控件旁边有实时数值吗？
- [ ] 拖动到极端值会发生什么？试过了吗？
- [ ] 不用鼠标，只用键盘能走完整个叙事吗？
- [ ] 读者玩完之后，能说出一个他之前不知道的判断吗？
