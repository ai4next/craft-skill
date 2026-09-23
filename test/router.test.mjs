/**
 * 路由器回归：几何不变量 + 交叉规避确实有效。
 *
 * 这些断言以前完全不存在 —— 几何改动只能靠人肉看截图。
 * 示例本身是「干净」的（0 交叉、0 通道叠用），所以光测示例不足以证明路由器在干活，
 * 必须另造一个真正有交叉的压力模型。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, EXAMPLES, readExample } from './helpers.mjs';
import { makeLayoutSandbox, artifactModels } from '../scripts/sandbox.mjs';

const TEMPLATE = fs.readFileSync(path.join(ROOT, 'assets/template.html'), 'utf8');

/** 分层 × 每层若干节点，边在层间反向连接 —— 制造大量交叉与通道争用 */
function stress(layers, per, stride) {
  const nodes = [], edges = [];
  const id = (l, i) => `n${l}_${i}`;
  for (let l = 0; l < layers; l++)
    for (let i = 0; i < per; i++)
      nodes.push({ id: id(l, i), label: `L${l}-${i}`, kind: l === 0 ? 'external' : l === layers - 1 ? 'database' : 'backend' });
  let k = 0;
  for (let l = 0; l + 1 < layers; l++) {
    for (let i = 0; i < per; i++) {
      edges.push({ id: `e${k++}`, from: id(l, i), to: id(l + 1, (i * stride + 1) % per) });
      if (l + 2 < layers && i % 2 === 0)
        edges.push({ id: `e${k++}`, from: id(l, i), to: id(l + 2, (i * stride) % per) });
    }
  }
  return { kind: 'architecture', direction: 'LR', title: 'stress', nodes, edges };
}

function run(template, model) {
  const craft = makeLayoutSandbox(template);
  if (!craft || craft.__error) throw new Error('沙箱执行失败：' + (craft && craft.__error));
  return craft.layout.run(craft.model.fromJSON(model, model.kind));
}

/** 关掉交叉与通道权重 —— 等价于改动前的「只看拐弯与路程」行为，用作对照基线 */
const NEUTRAL = TEMPLATE
  .replace('crossW: 1000,', 'crossW: 0,')
  .replace('shareW: 1.5,', 'shareW: 0,');

const exampleDirs = fs.readdirSync(EXAMPLES, { withFileTypes: true })
  .filter(e => e.isDirectory() && fs.existsSync(path.join(EXAMPLES, e.name, 'index.html')))
  .map(e => e.name).sort();

test('每个示例：0 降级路由、0 遮挡标签', () => {
  for (const t of exampleDirs) {
    const src = readExample(t);
    const craft = makeLayoutSandbox(src);
    if (!craft || craft.__error) continue;      // chart 没有图解模型
    for (const { data } of artifactModels(src)) {
      if (!data || (!data.nodes && !data.steps && !data.events && !data.participants)) continue;
      const s = craft.layout.run(craft.model.fromJSON(data, data.kind));
      assert.equal(s.stats.degradedRoutes, 0, `${t}: 有降级路由`);
      assert.equal(s.stats.maskedLabels || 0, 0, `${t}: 有被遮挡的标签`);
    }
  }
});

test('示例的几何不受交叉规避影响（示例本来就没有交叉可躲）', () => {
  /* 新逻辑在示例上应当是零影响 —— 若这条失败，说明路由改动波及了展示用的干净图，
     需要人工看图确认是否可接受。diagram-workflow 是已知例外（见下一条）。 */
  for (const t of exampleDirs) {
    if (t === 'diagram-workflow') continue;
    const src = readExample(t);
    const withNew = makeLayoutSandbox(src);
    if (!withNew || withNew.__error) continue;
    for (const { data } of artifactModels(src)) {
      if (!data || (!data.nodes && !data.steps && !data.events && !data.participants)) continue;
      const a = withNew.layout.run(withNew.model.fromJSON(data, data.kind));
      const b = run(NEUTRAL, data);
      assert.deepEqual(
        a.edges.map(e => e.points), b.edges.map(e => e.points),
        `${t}: 路由折线被交叉规避改动了`
      );
    }
  }
});

test('交叉规避确实减少交叉，且不制造降级路由', () => {
  const models = [stress(3, 4, 3), stress(4, 6, 3), stress(6, 8, 3), stress(8, 6, 5)];
  let improved = 0;
  for (const m of models) {
    const now = run(TEMPLATE, m);
    const base = run(NEUTRAL, m);
    assert.equal(now.stats.degradedRoutes, 0, `压力模型出现降级路由（${m.nodes.length} 节点）`);
    assert.ok(
      now.stats.routeCrossings <= base.stats.routeCrossings,
      `压力模型交叉数变多了：${base.stats.routeCrossings} → ${now.stats.routeCrossings}`
    );
    if (now.stats.routeCrossings < base.stats.routeCrossings) improved++;
  }
  assert.ok(improved > 0, '交叉规避在所有压力模型上都没起作用 —— 等于没实现');
});

test('布局确定性：同一模型两次结果逐字节相同', () => {
  for (const m of [stress(4, 6, 3), stress(6, 8, 3)]) {
    const a = JSON.stringify(run(TEMPLATE, m));
    const b = JSON.stringify(run(TEMPLATE, m));
    assert.equal(a, b, '同一模型两次布局不一致 —— 存在非确定性来源');
  }
});

test('单边端口溢出：maxPerSide 生效（钉住的朝向不被搬走）', () => {
  /* 一个节点右侧挂 8 条边 —— 远超 maxPerSide=4，必须溢出到别的朝向。
     同时钉住其中一条的 fromSide，它必须保持不动。 */
  const nodes = [{ id: 'hub', label: 'hub', kind: 'backend' }];
  const edges = [];
  for (let i = 0; i < 8; i++) {
    nodes.push({ id: `s${i}`, label: `s${i}`, kind: 'backend' });
    edges.push({ id: `e${i}`, from: 'hub', to: `s${i}` });
  }
  edges[0].fromSide = 'right';                 // 钉住
  const s = run(TEMPLATE, { kind: 'architecture', direction: 'LR', title: 'fan', nodes, edges });
  const sides = s.edges.map(e => e.fromSide);
  const rightCount = sides.filter(x => x === 'right').length;
  assert.ok(rightCount <= 4, `hub 右侧仍挂了 ${rightCount} 条边，超过 maxPerSide`);
  assert.equal(s.edges[0].fromSide, 'right', '作者钉住的 fromSide 被搬走了');
});
