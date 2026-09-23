/**
 * Mermaid 解析器：结构断言 + 端到端（生成的模型必须能通过 check.mjs）。
 *
 * 端到端那组是关键 —— 只断言「解析出来的对象长什么样」不够，
 * 真正要保证的是「解析出来的东西能被运行时布局、能过门禁」。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, runCheck } from './helpers.mjs';
import { parseMermaid } from '../scripts/mermaid.mjs';

const TEMPLATE = fs.readFileSync(path.join(ROOT, 'assets/template.html'), 'utf8');
const FIXTURES = path.join(ROOT, 'test/fixtures');

const read = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

/** 用模板 + 生成的模型拼一个真产物，跑真门禁 */
function checkModel(model) {
  const body = `<h1>测试</h1>\n<div data-craft-diagram="${model.kind}" data-craft-model="main" ` +
               `data-craft-diagram-label="测试图"></div>`;
  const data = `<script type="application/json" data-craft-data="main">\n` +
               JSON.stringify(model, null, 2) + `\n</script>`;
  const html = TEMPLATE
    .replace('<!-- CRAFT:HEAD_SLOT -->', '<title>测试</title>')
    .replace('<!-- CRAFT:BODY_SLOT -->', body)
    .replace('<!-- CRAFT:DATA_SLOT -->', data)
    .replace('<!-- CRAFT:SCRIPT_SLOT -->', '')
    .replace(/(<body[^>]*\bdata-craft-type=")[^"]*(")/, (_, a, b) => a + 'diagram' + b);

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'craft-mmd-')), 'candidate.html');
  fs.writeFileSync(file, html);
  return runCheck(file);
}

test('flowchart → workflow', () => {
  const { model, warnings } = parseMermaid(read('flowchart.mmd'), { type: 'workflow', title: 't' });
  assert.equal(model.kind, 'workflow');
  assert.equal(model.nodes.length, 6);
  assert.equal(model.edges.length, 6);
  assert.deepEqual(warnings, []);

  const byId = Object.fromEntries(model.nodes.map(n => [n.id, n]));
  assert.equal(byId.A.kind, 'start', '无入度的应是 start');
  assert.equal(byId.F.kind, 'end', '无出度的应是 end');
  assert.equal(byId.C.kind, 'decision', '{ } 应是决策菱形');
  assert.equal(byId.A.label, '客户端', '方括号里的文字应是标签');

  /* 中文按 UTF-16 码位排序：否(U+5426) 在 是(U+662F) 前面 —— 别按拼音想当然 */
  const labels = model.edges.filter(e => e.label).map(e => e.label).sort();
  assert.deepEqual(labels, ['否', '是'], '| | 里的文字应是边标签');
  assert.ok(model.lanes.length >= 1, 'workflow 必须有 lanes（契约必需字段）');
  assert.ok(model.nodes.every(n => n.lane), '每个步骤都必须归属某条泳道');
});

test('flowchart → architecture', () => {
  const { model } = parseMermaid(read('flowchart.mmd'), { type: 'architecture', title: 't' });
  assert.equal(model.kind, 'architecture');
  for (const n of model.nodes) {
    assert.ok(['external', 'backend', 'database'].includes(n.kind), `意外的 kind：${n.kind}`);
  }
});

test('sequenceDiagram → sequence', () => {
  const { model } = parseMermaid(read('sequence.mmd'), { title: 't' });
  assert.equal(model.kind, 'sequence');
  assert.deepEqual(model.participants.map(p => p.id), ['U', 'A']);
  assert.equal(model.participants[0].label, '用户', 'as 后面应是显示名');
  assert.equal(model.messages.length, 3);
  assert.equal(model.messages[2].kind, 'return', '虚线箭头（-->>）应是返回');
  assert.ok(!model.messages[0].kind, '实线箭头不该标成返回');
});

test('stateDiagram → lifecycle', () => {
  const { model } = parseMermaid(read('state.mmd'), { title: 't' });
  assert.equal(model.kind, 'lifecycle');
  /* 中文状态名清洗后会退化成下划线 —— 绝不能因此把不同状态合并成一个 id */
  const ids = new Set(model.events.map(e => e.id).concat((model.outcomes || []).map(o => o.id)));
  assert.equal(ids.size, 4, `四个状态应有四个不同 id，实际 ${ids.size}`);
  const labels = model.events.concat(model.outcomes || []).map(e => e.label).sort();
  assert.deepEqual(labels, ['失败', '已完成', '执行中', '排队'].sort());

  assert.equal(model.outcomes.length, 1, '指向 [*] 的状态应是终态');
  assert.equal(model.outcomes[0].label, '已完成');
  /* 带环（失败 → 排队）时不能把所有状态挤进同一相位 */
  assert.ok(model.phases.length >= 2, `带环的状态机也应分出多个相位，实际 ${model.phases.length}`);
});

test('端到端：三种输入生成的产物都必须过 check.mjs', () => {
  const cases = [
    ['flowchart.mmd', { type: 'workflow', title: '流程图' }],
    ['flowchart.mmd', { type: 'architecture', title: '架构图' }],
    ['sequence.mmd', { title: '时序图' }],
    ['state.mmd', { title: '状态机' }]
  ];
  for (const [file, opts] of cases) {
    const { model } = parseMermaid(read(file), opts);
    const { report } = checkModel(model);
    assert.ok(report, `${file}: check.mjs 没有输出可解析的 JSON`);
    const errs = report.diagnostics.filter(d => d.severity === 'error');
    assert.equal(
      report.summary.errors, 0,
      `${file} (${model.kind}) 生成的产物有 error：\n` +
      errs.map(d => `  ${d.code} — ${d.message}`).join('\n')
    );
  }
});

test('确定性：同一份输入解析两次结果逐字节相同', () => {
  for (const file of ['flowchart.mmd', 'sequence.mmd', 'state.mmd']) {
    const a = JSON.stringify(parseMermaid(read(file), { title: 't' }));
    const b = JSON.stringify(parseMermaid(read(file), { title: 't' }));
    assert.equal(a, b, `${file} 解析结果不稳定`);
  }
});

test('无法识别的输入要明确报错，而不是产出半个模型', () => {
  assert.throws(() => parseMermaid('pie title x\n "a": 1', {}), /无法识别的 Mermaid 图类型/);
});
