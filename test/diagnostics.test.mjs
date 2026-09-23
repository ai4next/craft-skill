/**
 * 反向夹具：故意做坏的产物必须报出**预期的那一个**诊断码。
 *
 * 这是把 CLAUDE.md 里「手工构造反向测试」那句散文固化成机器可跑的断言。
 * 门禁最危险的失效方式不是误报，而是漏报 —— 一条本该触发的规则静默不触发，
 * 产物照样 0 error 通过。所以每个新规则都要在这里有一条对应的夹具。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readExample, checkMutated, mutateModel, runCheck } from './helpers.mjs';
import { EXAMPLES } from './helpers.mjs';
import path from 'node:path';

/* [夹具名, 期望的诊断码, 变形函数, 基础示例, 期望严重度]
   严重度必须写对：warning 不会让退出码变 1，断言退出码时要用它。 */
const CASES = [
  ['无运行时 → runtime-missing',
    'layout/runtime-missing',
    /* 产物里有两个 data-craft-owned 区块，必须全部去掉才能让沙箱真的失效 */
    html => html.replace(/<script data-craft-owned>/g, '<script>'),
    'diagram-architecture', 'error'],

  ['悬空边',
    'model/dangling-edge',
    html => mutateModel(html, m => { m.edges[0].to = '这个节点不存在'; }),
    'diagram-architecture', 'error'],

  ['重复节点 id',
    'model/duplicate-id',
    html => mutateModel(html, m => { m.nodes[1].id = m.nodes[0].id; }),
    'diagram-architecture', 'error'],

  ['direction 拼错',
    'model/direction-invalid',
    html => mutateModel(html, m => { m.direction = 'sideways'; }),
    'diagram-architecture', 'error'],

  ['节点引用了不存在的分组',
    'model/unknown-group',
    html => mutateModel(html, m => { m.nodes[0].group = '不存在的分组'; }),
    'diagram-architecture', 'error'],

  ['dataflow 节点引用了不存在的阶段',
    'model/unknown-stage',
    html => mutateModel(html, m => { m.nodes[0].stage = '不存在的阶段'; }),
    'diagram-dataflow', 'error'],

  ['workflow 步骤引用了不存在的泳道',
    'model/unknown-lane',
    html => mutateModel(html, m => { m.steps[0].lane = '不存在的泳道'; }),
    'diagram-workflow', 'error'],

  ['lifecycle 事件引用了不存在的相位',
    'model/unknown-phase',
    html => mutateModel(html, m => { m.events[0].phase = '不存在的相位'; }),
    'diagram-lifecycle', 'error'],

  ['sequence 的 block 下标越界',
    'model/block-range',
    html => mutateModel(html, m => { m.blocks[0].to = 999; }),
    'diagram-sequence', 'error'],

  ['哨兵没填',
    'artifact/sentinel-unfilled',
    html => html.replace('<body', '<!-- CRAFT:BODY_SLOT -->\n<body'),
    'diagram-architecture', 'error'],

  ['引了外部资源',
    'artifact/no-external-ref',
    html => html.replace('</body>', '<img src="https://example.com/a.png" alt="x"></body>'),
    'diagram-architecture', 'error'],

  ['缺 <html lang>',
    'html/lang-missing',
    html => html.replace('<html lang="zh-CN"', '<html'),
    'diagram-architecture', 'error'],

  ['缺 viewport',
    'html/viewport-missing',
    html => html.replace(/<meta name="viewport"[^>]*>\n?/, ''),
    'diagram-architecture', 'error'],

  ['作者区硬编码颜色',
    'theme/hardcoded-color',
    html => html.replace('</head>', '<style>.probe-x { color: #ff0000; }</style></head>'),
    'diagram-architecture', 'warning'],

  ['标签被遮挡（masked）',
    'layout/label-masked',
    /* 单条边标签超长 → 找不到无冲突落点。用这条而不是拿某个示例当夹具：
       示例本身是干净的，夹具必须自己造出缺陷。 */
    html => mutateModel(html, m => { m.edges[0].label = '一条特别特别长的关系标签文字'; }),
    'diagram-architecture', 'error']
];

for (const [name, code, mutate, base, severity] of CASES) {
  test(`反向夹具：${name} → ${code}`, () => {
    const { status, codes } = checkMutated(mutate(readExample(base)), code.replace(/\W+/g, '-'));
    assert.ok(
      codes.includes(code),
      `期望报出 ${code}，实际报出：[${[...new Set(codes)].join(', ')}]`
    );
    assert.equal(
      status, severity === 'error' ? 1 : 0,
      `${severity} 的诊断应让退出码为 ${severity === 'error' ? 1 : 0}，实际 ${status}`
    );
  });
}

test('干净的示例不得报出任何 error（夹具本身没有误伤基线）', () => {
  const { report } = runCheck(path.join(EXAMPLES, 'diagram-architecture', 'index.html'));
  assert.equal(report.summary.errors, 0);
});

test('注释掉的数据块不算数据块 —— 不得误报 data/json-invalid', () => {
  /* 契约要求「没内容可填就删掉整个注释」，作者临时注释掉数据块也很自然。
     按原文扫描会把注释里的 <script> 当成真的区块，于是报出指着注释的
     data/json-invalid、外加一条把注释算进去的 data/size —— 全是假警报。
     正确行为是：认不出数据块，于是报「图表引用了不存在的数据块」。 */
  const html = readExample('chart').replace(
    /(<script type="application\/json" data-craft-data="main">[\s\S]*?<\/script>)/,
    m => `<!-- ${m} -->`
  );
  const { codes } = checkMutated(html, 'commented-datablock');
  assert.ok(
    !codes.includes('data/json-invalid'),
    `注释里的数据块被当成了真数据块：[${[...new Set(codes)].join(', ')}]`
  );
});

test('注释掉的图表容器不算图表 —— 不得指着注释报字段缺失', () => {
  /* 与上一条同源：作者把一整块图表注释掉是很自然的动作。
     只屏蔽数据块的注释是不够的 —— 作者区里的注释同样不能被当成活的声明。 */
  const base = readExample('chart');

  /* 只注释作者区的图表容器：运行时的文档注释里也写着 data-craft-chart 的示例，
     注释掉它会破坏 owned 区块，那是另一个诊断要管的事。
     注意不能简单地按第一个 <script data-craft-owned> 切 —— head 里还有一个。 */
  const owned = [...base.matchAll(/<script data-craft-owned>[\s\S]*?<\/script>/g)]
    .map(m => [m.index, m.index + m[0].length]);
  const inOwned = (i) => owned.some(([a, b]) => i >= a && i < b);

  const commented = base.replace(
    /(<div data-craft-chart=[\s\S]*?><\/div>)/g,
    (m, _g, off) => (inOwned(off) ? m : `<!-- ${m} -->`)
  );
  assert.notEqual(commented, base, '夹具没有生效：一个图表容器都没注释掉');

  const bad = m => { m.rows.forEach(r => { delete r.users; }); };
  const off = checkMutated(mutateModel(commented, bad), 'chart-commented');
  const on = checkMutated(mutateModel(base, bad), 'chart-live');

  assert.ok(
    !off.codes.includes('contract/chart-fields'),
    `注释掉的图表仍被校验：[${[...new Set(off.codes)].join(', ')}]`
  );
  /* 正对照：图表没被注释时，同样的坏数据必须仍然报出来 ——
     否则「修好」只是把规则整个关掉了。 */
  assert.ok(
    on.codes.includes('contract/chart-fields'),
    `图表正常时反而没报字段缺失：[${[...new Set(on.codes)].join(', ')}]`
  );
});

test('确定性：同一模型两次布局逐字节相同', () => {
  /* layout/deterministic 规则会自己跑两次比对。这里断言它不触发，
     等于断言布局没有引入随机或对象键序依赖。 */
  const { codes } = checkMutated(readExample('diagram-architecture'), 'determinism');
  assert.ok(!codes.includes('layout/deterministic'), '布局结果不稳定');
});
