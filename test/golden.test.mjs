/**
 * 黄金测试：仓库当前声明的健康状态必须为真。
 *
 * 这两条是整个仓库最基础的不变量：
 *   1. 每个示例产物 0 error
 *   2. 派生文件（镜像、示例、锁）与源一致
 *
 * 它们以前只存在于 CLAUDE.md 的散文里，靠人记得跑。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, EXAMPLES, runCheck, checkMutated, assembleSkeleton } from './helpers.mjs';

const types = fs.readdirSync(EXAMPLES, { withFileTypes: true })
  .filter(e => e.isDirectory() && fs.existsSync(path.join(EXAMPLES, e.name, 'index.html')))
  .map(e => e.name)
  .sort();

test('examples/ 至少有一个示例', () => {
  assert.ok(types.length > 0, '没有找到任何示例产物');
});

for (const type of types) {
  test(`示例 ${type} 必须 0 error`, () => {
    const { status, report } = runCheck(path.join(EXAMPLES, type, 'index.html'));
    assert.ok(report, `${type}: check.mjs 没有输出可解析的 JSON`);
    const errs = report.diagnostics.filter(d => d.severity === 'error');
    assert.equal(
      report.summary.errors, 0,
      `${type} 有 ${report.summary.errors} 个 error：\n` +
      errs.map(d => `  ${d.code} — ${d.message}`).join('\n')
    );
    assert.equal(status, 0, `${type}: 退出码应为 0，实际 ${status}`);
  });

  /* SKILL.md 的快速路径要求「读对应类型的 skeleton.html」——
     少了它，那条路径对这类产物就是死胡同。以前 explainer/simulation 就没有。 */
  test(`示例 ${type} 必须有 skeleton.html`, () => {
    const p = path.join(EXAMPLES, type, 'skeleton.html');
    assert.ok(fs.existsSync(p), `${type} 缺 skeleton.html —— SKILL.md 的快速路径会指向一个不存在的文件`);
  });

  /* 骨架是模型照抄的模板，坏掉的骨架比没有骨架更糟：它会把错误示范复制到每一份产物里。
     所以骨架必须自己先过门禁 —— 组装成完整产物再跑 check.mjs。 */
  test(`示例 ${type} 的 skeleton.html 组装后必须 0 error`, () => {
    const { status, report } = checkMutated(assembleSkeleton(type), `skeleton-${type}`);
    assert.ok(report, `${type}/skeleton.html: check.mjs 没有输出可解析的 JSON`);
    const errs = (report.diagnostics || []).filter(d => d.severity === 'error');
    assert.equal(
      report.summary.errors, 0,
      `${type}/skeleton.html 组装后有 ${report.summary.errors} 个 error：\n` +
      errs.map(d => `  ${d.code} — ${d.message}`).join('\n')
    );
    assert.equal(status, 0, `${type}/skeleton.html: 退出码应为 0，实际 ${status}`);
  });
}

test('--mirror 下镜像与文档必须一致', () => {
  const { report } = runCheck(path.join(EXAMPLES, types[0], 'index.html'), ['--mirror']);
  assert.ok(report, 'check.mjs --mirror 没有输出可解析的 JSON');
  const errs = report.diagnostics.filter(d => d.severity === 'error');
  assert.equal(
    report.summary.errors, 0,
    `仓库一致性检查失败：\n` + errs.map(d => `  ${d.code} — ${d.message}`).join('\n')
  );
});

test('sync.mjs --check 必须通过（派生文件已同步）', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/sync.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `派生文件未同步，跑 node scripts/sync.mjs\n${r.stdout}`);
});
